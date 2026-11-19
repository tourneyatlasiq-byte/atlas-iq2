/**
 * The real server actions, run against a real local database.
 *
 *   action (lib/actions/*.js)  ->  @supabase/supabase-js  ->  local REST shim
 *     ->  row security + triggers  ->  the pending migration's functions
 *
 * Only the framework edges are stood in: next/cache, the session/context lookup
 * (which user and organization is "signed in") and how the client is built
 * (a real supabase-js client, signed in with a real signed JWT).
 *
 * Run via scripts/test-actions-local.sh (it builds the database and starts
 * the shim). Local fixture only; never touches Supabase.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Module = require("module");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const URL_ = process.env.POSTGREST_URL;
const DB = process.env.DB_NAME;
const SECRET = process.env.JWT_SECRET;
if (!URL_ || !DB || !SECRET) { console.error("Run via scripts/test-actions-local.sh"); process.exit(2); }

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : `\n        ${detail === undefined ? "" : JSON.stringify(detail)}`}`);
}
const section = (t) => console.log(`\n${t}\n`);

/* ---- identities (same ids as actions-seed.sql) ---- */
const A = "a0000000-0000-0000-0000-000000000001", B = "b0000000-0000-0000-0000-000000000001";
const SEASON_A = "5a000000-0000-0000-0000-000000000001", SEASON_B = "5b000000-0000-0000-0000-000000000001";
const USERS = {
  owner:  { id: "10000000-0000-0000-0000-000000000001", role: "owner",  org: A, season: SEASON_A },
  coach:  { id: "10000000-0000-0000-0000-000000000002", role: "coach",  org: A, season: SEASON_A },
  parent: { id: "10000000-0000-0000-0000-000000000003", role: "parent", org: A, season: SEASON_A },
  coachB: { id: "10000000-0000-0000-0000-000000000004", role: "coach",  org: B, season: SEASON_B },
};
const LINE = "e0000000-0000-0000-0000-000000000001", LINE2 = "e0000000-0000-0000-0000-000000000002";
const T = (n) => `c0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const P = (n) => `f0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

function b64(o) { return Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url"); }
function jwtFor(u) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: u.id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

let current = USERS.owner;
const { createClient } = require("@supabase/supabase-js");
function clientFor(u) {
  return createClient("http://localhost:0", "anon-key-not-checked", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${jwtFor(u)}` },
      // supabase-js addresses /rest/v1/*; the shim serves the same paths at /*.
      fetch: (url, opts) => fetch(String(url).replace("http://localhost:0/rest/v1", URL_), opts),
    },
  });
}

/* ---- module loading: stand in only for the framework edges ---- */
const STUB = path.join(ROOT, "scripts", "__actions_stubs__");
const stubs = new Map([["next/cache", { revalidatePath() {} }]]);
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const CONTEXT = path.join(ROOT, "lib", "context.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (stubs.has(request)) return `${STUB}/${request}`;
  return origResolve.call(this, request, parent, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  let resolved = null; try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => clientFor(current) };
  if (resolved === CONTEXT) {
    return {
      requireSeasonContext: async () => ({
        profile: { role: current.role }, organization: { id: current.org }, season: { id: current.season },
      }),
      canWrite: (p) => ["owner", "admin", "coach", "manager"].includes(p.role),
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const SWC_OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(module, filename);
  const { code } = swc.transformSync(fs.readFileSync(filename, "utf8"), { ...SWC_OPTS, filename });
  module._compile(code, filename);
};
const tAct = require(path.join(ROOT, "lib", "actions", "tournaments.js"));
const fAct = require(path.join(ROOT, "lib", "actions", "finance.js"));

/* ---- helpers ---- */
const form = (o) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) fd.set(k, String(v)); return fd; };
const uuid = () => crypto.randomUUID();
const sql = (q) => execFileSync("psql", ["-At", "-d", DB, "-c", q], { encoding: "utf8" }).trim();
const as = (u) => { current = USERS[u]; };

(async () => {
  /* ===================== tournament status (compare and set) ===================== */
  section("setTournamentStatus: change, previous value, and Undo that cannot overwrite");
  as("owner");
  let r = await tAct.setTournamentStatus(form({ id: T(9), field: "decision", value: "Committed" }));
  ok("change succeeds and returns the previous value", r.ok === true && r.previous === "Considering", r);
  ok("database holds the new value", sql(`select decision from tournaments where id='${T(9)}'`) === "Committed");
  r = await tAct.setTournamentStatus(form({ id: T(9), field: "decision", value: "Banana" }));
  ok("an invalid value is refused and nothing changes", r.ok === false && sql(`select decision from tournaments where id='${T(9)}'`) === "Committed", r);
  // someone else changes it after our change; our Undo must not overwrite that
  await tAct.setTournamentStatus(form({ id: T(9), field: "decision", value: "Declined" }));
  r = await tAct.setTournamentStatus(form({ id: T(9), field: "decision", value: "Considering", expected: "Committed" }));
  ok("Undo is refused because the status changed after our change", r.ok === false && r.code === "changed" && r.current === "Declined", r);
  ok("...and the later change (Declined) is untouched", sql(`select decision from tournaments where id='${T(9)}'`) === "Declined");
  r = await tAct.setTournamentStatus(form({ id: T(9), field: "decision", value: "Committed", expected: "Declined" }));
  ok("Undo works when the status is still what we set", r.ok === true && sql(`select decision from tournaments where id='${T(9)}'`) === "Committed", r);

  /* ===================== Mark paid in full ===================== */

  // What the Mark paid dialog sends besides the paid figures: the cost it showed and the unpaid entries it showed.
  const figs = (id) => ({
    expected_cost: Number(sql(`select total_cost from tournaments where id='${id}'`)),
    expected_to_pay: JSON.stringify(JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'amount', actual_amount, 'txn_date', txn_date, 'budget_item_id', budget_item_id) order by id), '[]') from budget_transactions where tournament_id='${id}' and status='To Pay'`))),
  });
  section("markTournamentPaidInFull: save, retry, failed save, Undo");
  as("owner");
  const key1 = uuid();
  const dialog1 = { ...figs(T(1)), id: T(1), expected_status: "Deposit Paid", expected_paid: 300, expected_to_pay_count: 0, record_payment: "true", date: "2026-11-19" };
  r = await tAct.markTournamentPaidInFull(form({ ...dialog1, request_key: key1 }));
  ok("save succeeds and records only the remaining 350 (deposit of 300 counted)", r.ok === true && Number(r.recorded_amount) === 350, r);
  ok("tournament is Paid in Full", sql(`select paid_status from tournaments where id='${T(1)}'`) === "Paid in Full");
  const op1 = r.operation_id;
  const rowsAfterSave = sql(`select count(*) from budget_transactions where tournament_id='${T(1)}'`);
  r = await tAct.markTournamentPaidInFull(form({ ...dialog1, request_key: key1 }));
  ok("retry with the same key reports a duplicate", r.ok === true && r.duplicate === true && r.operation_id === op1, r);
  ok("retry recorded nothing more", sql(`select count(*) from budget_transactions where tournament_id='${T(1)}'`) === rowsAfterSave && rowsAfterSave === "2");
  r = await tAct.markTournamentPaidInFull(form({ ...dialog1, request_key: uuid() }));
  ok("a new key after success is refused (already paid), not recorded again", r.ok === false && r.code === "already_paid", r);

  r = await tAct.undoMarkTournamentPaidInFull(form({ operation_id: op1 }));
  ok("Undo through the action restores status and removes only the created payment",
    r.ok === true && sql(`select paid_status from tournaments where id='${T(1)}'`) === "Deposit Paid"
    && sql(`select count(*) from budget_transactions where tournament_id='${T(1)}'`) === "1", r);

  // failed save: stale dialog
  as("owner");
  sql(`insert into budget_transactions (organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status) values ('${A}','${SEASON_A}','${T(2)}','${LINE}','Tournaments','paid elsewhere',100,'Paid') returning id`);
  r = await tAct.markTournamentPaidInFull(form({ ...figs(T(2)), id: T(2), request_key: uuid(), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 0, record_payment: "true" }));
  ok("failed save (stale balance): reports changed with the live balance of 400", r.ok === false && r.code === "changed" && Number(r.state.remaining) === 400, r);
  ok("...and nothing was saved", sql(`select paid_status from tournaments where id='${T(2)}'`) === "Registered"
    && sql(`select count(*) from budget_transactions where tournament_id='${T(2)}'`) === "1");

  // failed save: error raised after the payment insert -> everything rolls back
  r = await tAct.markTournamentPaidInFull(form({ ...figs(T(5)), id: T(5), request_key: uuid(), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 0, record_payment: "true" }));
  ok("failed save (database error after the insert): the action reports it", r.ok === false && /forced failure/.test(r.error || ""), r);
  ok("...no payment row and status unchanged (atomic rollback)",
    sql(`select count(*) from budget_transactions where tournament_id='${T(5)}'`) === "0" && sql(`select paid_status from tournaments where id='${T(5)}'`) === "Registered");

  // Undo after a later change
  r = await tAct.markTournamentPaidInFull(form({ ...figs(T(4)), id: T(4), request_key: uuid(), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 0, record_payment: "true" }));
  const op4 = r.operation_id;
  as("coach");
  sql(`insert into budget_transactions (organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status) values ('${A}','${SEASON_A}','${T(4)}','${LINE}','Tournaments','later adjustment',20,'Paid')`);
  r = await tAct.undoMarkTournamentPaidInFull(form({ operation_id: op4 }));
  ok("Undo through the action is refused after a later payment", r.ok === false && r.code === "changed_since", r);
  ok("...status and both payments untouched", sql(`select paid_status from tournaments where id='${T(4)}'`) === "Paid in Full"
    && sql(`select count(*) from budget_transactions where tournament_id='${T(4)}'`) === "2");

  /* permissions through the actions */
  as("parent");
  r = await tAct.markTournamentPaidInFull(form({ ...figs(T(3)), id: T(3), request_key: uuid(), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 0 }));
  ok("a parent is refused by the action", r.ok === false && /role doesn't allow/.test(r.error), r);
  as("coachB");
  r = await tAct.markTournamentPaidInFull(form({ ...figs(T(3)), id: T(3), request_key: uuid(), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 0 }));
  ok("a coach from another organization cannot reach this tournament (RLS)", r.ok === false && r.code === "not_found", r);
  ok("...and it is unchanged", sql(`select paid_status from tournaments where id='${T(3)}'`) === "Registered");

  /* ===================== Finance: transactions ===================== */
  section("saveTransaction / undoNewTransaction: save, retry, failed save, Undo");
  as("owner");
  const tkey = uuid();
  const tform = { budget_item_id: LINE2, item: "Field rental", txn_date: "2026-11-19", actual_amount: 120, status: "Paid", request_key: tkey };
  r = await fAct.saveTransaction(form(tform));
  ok("save returns the new id", r.ok === true && !!r.id, r);
  const txnId = r.id;
  r = await fAct.saveTransaction(form(tform));
  ok("retry with the same key returns the first entry", r.ok === true && r.duplicate === true && r.id === txnId, r);
  ok("only one row exists", sql(`select count(*) from budget_transactions where item='Field rental'`) === "1");
  r = await fAct.saveTransaction(form({ ...tform, request_key: uuid(), budget_item_id: "" }));
  ok("failed save (no budget line) is refused and writes nothing", r.ok === false && sql(`select count(*) from budget_transactions where item='Field rental'`) === "1", r);
  r = await fAct.saveTransaction(form({ ...tform, request_key: uuid(), budget_item_id: "e0000000-0000-0000-0000-000000000004" }));
  ok("failed save (another organization's budget line) is refused", r.ok === false && sql(`select count(*) from budget_transactions where item='Field rental'`) === "1", r);
  const und = { id: txnId, expected_amount: 120, expected_status: "Paid", expected_date: "2026-11-19", expected_budget_item_id: LINE2, expected_item: "Field rental" };
  await fAct.saveTransaction(form({ ...tform, id: txnId, actual_amount: 130, request_key: undefined }));
  r = await fAct.undoNewTransaction(form(und));
  ok("Undo is refused after the entry was edited", r.ok === false && r.code === "changed_since" && Number(sql(`select actual_amount from budget_transactions where id='${txnId}'`)) === 130, r);
  await fAct.saveTransaction(form({ ...tform, id: txnId, actual_amount: 120, request_key: undefined }));
  r = await fAct.undoNewTransaction(form(und));
  ok("Undo removes the entry while it is unchanged", r.ok === true && sql(`select count(*) from budget_transactions where id='${txnId}'`) === "0", r);

  /* ===================== Finance: player payments ===================== */
  section("recordPayment / undoRecordedPayment: save, retry, failed save, Undo");
  as("owner");
  const pk = uuid();
  const pform = { payment_id: P(1), amount: 300, paid_date: "2026-11-19", month_label: "Nov", expected_paid: 200, request_key: pk };
  r = await fAct.recordPayment(form(pform));
  ok("save returns id, the new paid total (500) and entry count (2)", r.ok === true && !!r.id && Number(r.paid) === 500 && r.entry_count === 2, r);
  const e1 = r.id; const r0 = r;
  r = await fAct.recordPayment(form(pform));
  ok("retry with the same key returns the first entry and operation", r.ok === true && r.duplicate === true && r.id === e1 && r.operation_id === r0.operation_id, r);
  ok("retry recorded nothing (2 entries)", sql(`select count(*) from payment_log where payment_id='${P(1)}'`) === "2");
  r = await fAct.recordPayment(form({ ...pform, request_key: uuid() }));
  ok("failed save (stale balance): refused with the live figures", r.ok === false && r.code === "changed" && Number(r.paid) === 500 && r.entry_count === 2, r);
  ok("...and nothing was saved", sql(`select count(*) from payment_log where payment_id='${P(1)}'`) === "2");
  r = await fAct.recordPayment(form({ ...pform, request_key: uuid(), amount: 0 }));
  ok("failed save (no amount) is refused", r.ok === false && sql(`select count(*) from payment_log where payment_id='${P(1)}'`) === "2", r);
  r = await fAct.recordPayment(form({ payment_id: uuid(), amount: 10, request_key: uuid() }));
  ok("failed save (no such obligation) is refused", r.ok === false, r);
  const op1p = r0.operation_id;
  as("coach");
  r = await fAct.recordPayment(form({ payment_id: P(1), amount: 40, expected_paid: 500, request_key: uuid() }));
  ok("a second screen (a different user) records a later payment", r.ok === true && r.entry_count === 3, r);
  const op2p = r.operation_id;
  as("owner");
  r = await fAct.undoRecordedPayment(form({ operation_id: op1p }));
  ok("Undo of the earlier payment is refused: a later payment exists", r.ok === false && r.code === "changed_since", r);
  ok("...all three entries still there", sql(`select count(*) from payment_log where payment_id='${P(1)}'`) === "3");
  r = await fAct.undoRecordedPayment(form({ operation_id: op1p, expected_entry_count: 2, expected_amount: 300 }));
  ok("wrong or stale counts and amounts sent by a caller change nothing: the database decides, still refused", r.ok === false && r.code === "changed_since", r);
  r = await fAct.undoRecordedPayment(form({}));
  ok("Undo with no operation id is refused", r.ok === false, r);
  r = await fAct.undoRecordedPayment(form({ operation_id: uuid() }));
  ok("Undo with an unknown operation id is refused", r.ok === false && r.code === "not_found", r);
  r = await fAct.undoRecordedPayment(form({ operation_id: op2p }));
  ok("Undo of the newest payment succeeds", r.ok === true && sql(`select count(*) from payment_log where payment_id='${P(1)}'`) === "2", r);
  r = await fAct.undoRecordedPayment(form({ operation_id: op2p }));
  ok("repeating that Undo is refused (already undone)", r.ok === false && r.code === "already_undone", r);
  ok("...and removed nothing more", sql(`select count(*) from payment_log where payment_id='${P(1)}'`) === "2");
  sql(`update player_payments set initial_cost = 1100 where id='${P(1)}'`);
  r = await fAct.undoRecordedPayment(form({ operation_id: op1p }));
  ok("Undo is refused after what the player owes changed", r.ok === false && r.code === "changed_since", r);
  as("parent");
  r = await fAct.undoRecordedPayment(form({ operation_id: op1p }));
  ok("a parent is refused by the action", r.ok === false, r);

  section("Legacy callers keep working");
  as("owner");
  r = await fAct.recordPayment(form({ payment_id: P(3), amount: 25 }));
  ok("recordPayment with no request_key and no expected_paid still saves (old form)", r.ok === true && sql(`select count(*) from payment_log where payment_id='${P(3)}'`) === "1", r);
  r = await fAct.saveTransaction(form({ budget_item_id: LINE2, item: "legacy", txn_date: "2026-11-19", actual_amount: 5 }));
  ok("saveTransaction with no request_key still saves (old form)", r.ok === true, r);
  r = await tAct.setTournamentStatus(form({ id: T(9), field: "paid_status", value: "Registered" }));
  ok("setTournamentStatus without expected still works (old call)", r.ok === true, r);

  /* ===================== simultaneous screens through the actions ===================== */
  section("Simultaneous payments from separate screens, different retry keys");
  const screens = ["owner", "coach", "owner", "coach", "owner", "coach"];
  const results = await Promise.all(screens.map(async (u) => {
    // each "screen" is its own signed-in client, all showing paid = 0
    const prev = current; current = USERS[u];
    const res = await fAct.recordPayment(form({ payment_id: P(2), amount: 100, expected_paid: 0, request_key: uuid() }));
    current = prev; return res;
  }));
  ok("exactly one of six saved", results.filter((x) => x.ok).length === 1, results.map((x) => x.code || (x.ok ? "ok" : x.error)));
  ok("the other five were told the balance changed", results.filter((x) => x.code === "changed").length === 5);
  ok("one row, $100, in the database", sql(`select count(*)||':'||sum(amount) from payment_log where payment_id='${P(2)}'`) === "1:100.00");

  section("Simultaneous Mark paid in full from separate screens, different keys");
  const dlg = { ...figs(T(6)), id: T(6), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 0, record_payment: "true" };
  const mres = await Promise.all(["owner", "coach", "owner", "coach"].map(async (u) => {
    const prev = current; current = USERS[u];
    const res = await tAct.markTournamentPaidInFull(form({ ...dlg, request_key: uuid() }));
    current = prev; return res;
  }));
  ok("exactly one saved", mres.filter((x) => x.ok).length === 1, mres.map((x) => x.code || "ok"));
  ok("exactly one $300 payment recorded", sql(`select count(*)||':'||sum(actual_amount) from budget_transactions where tournament_id='${T(6)}'`) === "1:300.00");
  ok("the others were refused as already paid", mres.filter((x) => x.code === "already_paid").length === 3);

  section("Mark paid in full refuses when the cost or an unpaid entry changed after the dialog opened");
  sql(`insert into tournaments (id, organization_id, season_id, name, entry_fee, gate_fee, decision, paid_status, budget_item_id) values
    ('${T(11)}','${A}','${SEASON_A}','Cost changed',500,0,'Committed','Registered','${LINE}'),
    ('${T(12)}','${A}','${SEASON_A}','Entry changed',450,0,'Committed','Registered','${LINE}')`);
  sql(`insert into budget_transactions (id, organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status, txn_date)
    values ('d0000000-0000-0000-0000-0000000000e1','${A}','${SEASON_A}','${T(12)}','${LINE}','Tournaments','owed',450,'To Pay','2026-11-01')`);
  const openDialogCost = figs(T(11)), openDialogEntry = figs(T(12));
  sql(`update tournaments set entry_fee = 650 where id='${T(11)}'`);
  r = await tAct.markTournamentPaidInFull(form({ ...openDialogCost, id: T(11), request_key: uuid(), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 0, record_payment: "true" }));
  ok("a cost edited after the dialog opened is refused with the live cost", r.ok === false && r.code === "changed" && Number(r.state?.total_cost) === 650, r);
  ok("...and nothing was saved", sql(`select count(*) from budget_transactions where tournament_id='${T(11)}'`) === "0");
  sql(`update budget_transactions set actual_amount = 400 where id='d0000000-0000-0000-0000-0000000000e1'`);
  r = await tAct.markTournamentPaidInFull(form({ ...openDialogEntry, id: T(12), request_key: uuid(), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 1, record_payment: "true", to_pay_id: "d0000000-0000-0000-0000-0000000000e1" }));
  ok("an unpaid entry edited after the dialog opened is refused", r.ok === false && r.code === "changed", r);
  ok("...and the entry is still To Pay", sql(`select status from budget_transactions where id='d0000000-0000-0000-0000-0000000000e1'`) === "To Pay");
  r = await tAct.markTournamentPaidInFull(form({ ...figs(T(12)), id: T(12), request_key: uuid(), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 1, record_payment: "true", to_pay_id: "d0000000-0000-0000-0000-0000000000e1" }));
  ok("saving again from the refreshed figures succeeds", r.ok === true && sql(`select status from budget_transactions where id='d0000000-0000-0000-0000-0000000000e1'`) === "Paid", r);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
