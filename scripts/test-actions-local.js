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
const rAct = require(path.join(ROOT, "lib", "actions", "roster.js"));

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

  /* ===================== cost versus unpaid entry: the server never leaves the difference silent ===================== */
  section("markTournamentPaidInFull: a payment smaller than what is owed is refused, and the cost is never written");
  as("owner");
  const mk = (n, entry, gate) => sql(`insert into tournaments (id, organization_id, season_id, name, entry_fee, gate_fee, decision, paid_status, budget_item_id) values ('${T(n)}','${A}','${SEASON_A}','T${n} gap',${entry},${gate},'Committed','Registered','e0000000-0000-0000-0000-000000000001')`);
  const TXG = (n) => `d0000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
  const mkTx = (n, amt) => sql(`insert into budget_transactions (id, organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status, txn_date) values ('${TXG(n)}','${A}','${SEASON_A}','${T(n)}','e0000000-0000-0000-0000-000000000001','Tournaments','owed',${amt},'To Pay','2026-11-19')`);
  const send = (n, extra) => ({ ...figs(T(n)), id: T(n), request_key: uuid(), expected_status: "Registered", expected_paid: 0, expected_to_pay_count: 1, record_payment: "true", to_pay_id: TXG(n), amount: 400, ...extra });
  const fees = (n) => sql(`select entry_fee::numeric(10,2)||':'||gate_fee::numeric(10,2) from tournaments where id='${T(n)}'`);
  mk(21, 450, 0); mkTx(21, 400);
  r = await tAct.markTournamentPaidInFull(form(send(21, {})));
  ok("$400 against $450 owed is refused (code difference)", r.ok === false && r.code === "difference", r);
  ok("...nothing changed", sql(`select paid_status from tournaments where id='${T(21)}'`) === "Registered" && sql(`select status from budget_transactions where id='${TXG(21)}'`) === "To Pay" && fees(21) === "450.00:0.00");
  r = await tAct.markTournamentPaidInFull(form(send(21, { cost_fix: "cost" })));
  ok("a request that asks for a cost correction is still just refused; the action has no cost path", r.ok === false && r.code === "difference" && fees(21) === "450.00:0.00", r);
  r = await tAct.markTournamentPaidInFull(form(send(21, { amount: 450 })));
  ok("the full $450 saves", r.ok === true, r);
  ok("entry paid at 450, tournament Paid in Full, fees untouched", sql(`select status||':'||actual_amount::numeric(10,2) from budget_transactions where id='${TXG(21)}'`) === "Paid:450.00" && sql(`select paid_status from tournaments where id='${T(21)}'`) === "Paid in Full" && fees(21) === "450.00:0.00");
  const opId = JSON.parse(JSON.stringify(r)).operation_id;
  r = await tAct.undoMarkTournamentPaidInFull(form({ operation_id: opId }));
  ok("Undo restores the entry (400, To Pay) and the status", r.ok === true && sql(`select status||':'||actual_amount::numeric(10,2) from budget_transactions where id='${TXG(21)}'`) === "To Pay:400.00" && sql(`select paid_status from tournaments where id='${T(21)}'`) === "Registered", r);

  section("markTournamentPaidInFull: the cost corrected through the normal edit, then it saves");
  mk(22, 450, 0); mkTx(22, 400);
  sql(`update tournaments set entry_fee = 400 where id='${T(22)}'`);
  r = await tAct.markTournamentPaidInFull(form(send(22, {})));
  ok("with the corrected cost the $400 entry saves", r.ok === true && sql(`select paid_status from tournaments where id='${T(22)}'`) === "Paid in Full", r);

  section("markTournamentPaidInFull: status-only is never refused for a difference");
  mk(23, 450, 0); mkTx(23, 400);
  r = await tAct.markTournamentPaidInFull(form(send(23, { record_payment: "false", to_pay_id: "", amount: "" })));
  ok("status-only saves and leaves the entry To Pay", r.ok === true && sql(`select status from budget_transactions where id='${TXG(23)}'`) === "To Pay" && sql(`select paid_status from tournaments where id='${T(23)}'`) === "Paid in Full", r);

  /* ===================== roster: Make inactive / Make active persist ===================== */
  section("setRosterActive: what the drawer sends (assignment_id + is_active) saves and survives a reload");
  const R1 = "d0000000-0000-0000-0000-000000000001", R2 = "d0000000-0000-0000-0000-000000000002", R3 = "d0000000-0000-0000-0000-000000000003";
  // "Reload" = a brand-new client for the same signed-in user reading the row back, plus the database itself.
  const reload = async (id) => (await clientFor(current).from("team_season_players").select("is_active").eq("id", id).single()).data?.is_active;
  const dbActive = (id) => sql(`select is_active from team_season_players where id='${id}'`);
  as("coach");
  ok("starts active", dbActive(R1) === "t" && (await reload(R1)) === true);
  // RosterClient.toggleActive: fd.set("assignment_id", row.id); fd.set("is_active", String(next)); next = row.is_active === false -> false for an active row
  r = await rAct.setRosterActive(form({ assignment_id: R1, is_active: String(false) }));
  ok("Make inactive saves", r.ok === true, r);
  ok("...and after a reload the player is still inactive", dbActive(R1) === "f" && (await reload(R1)) === false);
  ok("...and a neighbouring player is untouched", dbActive(R2) === "t");
  r = await rAct.setRosterActive(form({ assignment_id: R1, is_active: String(true) }));
  ok("Make active saves", r.ok === true, r);
  ok("...and after a reload the player is active again", dbActive(R1) === "t" && (await reload(R1)) === true);
  r = await rAct.setRosterActive(form({ assignment_id: R1 }));
  ok("a request carrying no is_active value is never read as 'true' (the old Make active bug sent an event object)", r.ok === true && dbActive(R1) === "f", r);
  await rAct.setRosterActive(form({ assignment_id: R1, is_active: "true" }));
  as("parent");
  r = await rAct.setRosterActive(form({ assignment_id: R2, is_active: "false" }));
  ok("a parent cannot make a player inactive (row security)", dbActive(R2) === "t", r);
  as("coachB");
  r = await rAct.setRosterActive(form({ assignment_id: R1, is_active: "false" }));
  ok("a coach from another organization cannot change this roster", dbActive(R1) === "t", r);
  as("owner");
  sql(`update seasons set phase='past' where id='${SEASON_A}'`);
  r = await rAct.setRosterActive(form({ assignment_id: R2, is_active: "false" }));
  ok("owner can correct a finished season", dbActive(R2) === "f", r);
  as("coach");
  r = await rAct.setRosterActive(form({ assignment_id: R2, is_active: "true" }));
  ok("a coach cannot change a finished season's roster", dbActive(R2) === "f", r);
  sql(`update seasons set phase='current' where id='${SEASON_A}'`);


  /* ===================== income goals + payment entries: delete protections ===================== */
  section("deleteBudgetItem on income goals: clean delete, linked records protect it, move_to, roles, past seasons");
  const I = (n) => `e1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const mkGoal = (id, name, org = A, season = SEASON_A, income = true, goal = 500) =>
    sql(`insert into budget_items (id, organization_id, season_id, category, name, is_income, budgeted) values ('${id}','${org}','${season}','Sponsors','${name}',${income},${goal})`);
  const exists = (id) => sql(`select count(*) from budget_items where id='${id}'`) === "1";
  const mkIncomeTxn = (id, goalId) =>
    sql(`insert into budget_transactions (id, organization_id, season_id, budget_item_id, category, item, actual_amount, status, is_income, txn_date) values ('${id}','${A}','${SEASON_A}','${goalId}','Sponsors','Banner',650,'Paid',true,'2026-10-01')`);
  const TX_I = (n) => `e2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

  as("coach");
  mkGoal(I(1), "Clean goal");
  r = await fAct.deleteBudgetItem(form({ id: I(1) }));
  ok("an income goal with nothing linked deletes", r.ok === true && !exists(I(1)), r);

  mkGoal(I(2), "Goal with money received");
  mkIncomeTxn(TX_I(2), I(2));
  r = await fAct.deleteBudgetItem(form({ id: I(2) }));
  ok("a goal with a recorded receipt is refused with needsReassign and a count", r.ok === false && r.needsReassign === true && r.count === 1, r);
  ok("...the goal and the receipt are both still there, still linked", exists(I(2)) && sql(`select budget_item_id from budget_transactions where id='${TX_I(2)}'`) === I(2));

  r = await fAct.deleteBudgetItem(form({ id: I(2), move_to: LINE2 }));
  ok("move_to an EXPENSE line is refused for income receipts", r.ok === false && /don't match/.test(r.error ?? ""), r);
  ok("...nothing moved, nothing deleted", exists(I(2)) && sql(`select budget_item_id from budget_transactions where id='${TX_I(2)}'`) === I(2));

  mkGoal(I(3), "Other income goal");
  r = await fAct.deleteBudgetItem(form({ id: I(2), move_to: I(3) }));
  ok("move_to another INCOME goal moves the receipt, then deletes the goal", r.ok === true && !exists(I(2)) && sql(`select budget_item_id from budget_transactions where id='${TX_I(2)}'`) === I(3), r);
  ok("...the receipt amount is untouched by the move", Number(sql(`select actual_amount from budget_transactions where id='${TX_I(2)}'`)) === 650);

  r = await fAct.deleteBudgetItem(form({ id: LINE }));
  ok("a line a tournament is allocated to is refused and names the tournaments (the shared protection)", r.ok === false && Array.isArray(r.tournamentBlockers) && r.tournamentBlockers.length > 0, r);
  ok("...and is still there", exists(LINE));

  mkGoal(I(4), "Parent target");
  as("parent");
  r = await fAct.deleteBudgetItem(form({ id: I(4) }));
  ok("a parent cannot delete an income goal", r.ok === false && exists(I(4)), r);
  as("coachB");
  r = await fAct.deleteBudgetItem(form({ id: I(4) }));
  ok("a coach from another organization cannot delete it", exists(I(4)), r);
  as("owner");
  sql(`update seasons set phase='past' where id='${SEASON_A}'`);
  as("coach");
  r = await fAct.deleteBudgetItem(form({ id: I(4) }));
  ok("a coach cannot delete a goal in a finished season", exists(I(4)), r);
  as("owner");
  r = await fAct.deleteBudgetItem(form({ id: I(4) }));
  ok("an owner can correct a finished season", r.ok === true && !exists(I(4)), r);
  sql(`update seasons set phase='current' where id='${SEASON_A}'`);
  as("coach");
  r = await fAct.deleteBudgetItem(form({}));
  ok("a request with no id is refused", r.ok === false, r);

  section("saveBudgetItem on an income goal: edit keeps it an income goal");
  r = await fAct.saveBudgetItem(form({ id: I(3), category: "Sponsors", name: "Renamed goal", budget_method: "total", budgeted: "750", is_income: "true" }));
  ok("editing the name and goal saves", r.ok === true && sql(`select name || '|' || budgeted from budget_items where id='${I(3)}'`).startsWith("Renamed goal|750"), r);
  ok("...and it is still income", sql(`select is_income from budget_items where id='${I(3)}'`) === "t");
  as("parent");
  r = await fAct.saveBudgetItem(form({ id: I(3), category: "Sponsors", name: "Hacked", budget_method: "total", budgeted: "1", is_income: "true" }));
  ok("a parent cannot edit it", sql(`select name from budget_items where id='${I(3)}'`) === "Renamed goal", r);
  as("coach");

  section("deletePaymentEntry: removes only the chosen entry, keeps the payment record, respects roles");
  const PAY5 = "f0000000-0000-0000-0000-000000000005";
  const E1 = "e3000000-0000-0000-0000-000000000001", E2 = "e3000000-0000-0000-0000-000000000002";
  sql(`insert into player_payments (id, organization_id, season_id, player_name, initial_cost) values ('${PAY5}','${A}','${SEASON_A}','P5 entries',1000)`);
  sql(`insert into payment_log (id, payment_id, amount, paid_date) values ('${E1}','${PAY5}',100,'2026-10-01'),('${E2}','${PAY5}',50,'2026-10-05')`);
  const logIds = () => sql(`select string_agg(id::text, ',' order by amount) from payment_log where payment_id='${PAY5}'`);
  as("parent");
  r = await fAct.deletePaymentEntry(form({ id: E2 }));
  ok("a parent cannot remove a payment entry", logIds() === `${E2},${E1}`, r);
  as("coachB");
  r = await fAct.deletePaymentEntry(form({ id: E2 }));
  ok("a coach from another organization cannot", logIds() === `${E2},${E1}`, r);
  as("coach");
  r = await fAct.deletePaymentEntry(form({ id: E2 }));
  ok("a coach removes exactly the entry they chose", r.ok === true && logIds() === E1, r);
  ok("...the $100 entry and the payment record remain, total due unchanged", Number(sql(`select sum(amount) from payment_log where payment_id='${PAY5}'`)) === 100 && Number(sql(`select initial_cost from player_payments where id='${PAY5}'`)) === 1000, r);
  r = await fAct.deletePaymentEntry(form({}));
  ok("a request with no id is refused", r.ok === false, r);
  as("owner");
  sql(`update seasons set phase='past' where id='${SEASON_A}'`);
  as("coach");
  r = await fAct.deletePaymentEntry(form({ id: E1 }));
  ok("a coach cannot remove an entry from a finished season", logIds() === E1, r);
  as("owner");
  sql(`update seasons set phase='current' where id='${SEASON_A}'`);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
