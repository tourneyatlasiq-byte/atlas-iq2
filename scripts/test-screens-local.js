/**
 * The Group 1 screens (toasts with Undo, quick status actions, Mark paid in full,
 * Record payment, guided Add transaction), rendered in jsdom
 * and driven by clicks, calling the REAL server actions against the real local
 * database. Same harness as test-actions-local.js.
 *
 *   action (lib/actions/*.js)  ->  @supabase/supabase-js  ->  local REST shim
 *     ->  row security + triggers  ->  the pending migration's functions
 *
 * Only the framework edges are stood in: next/cache, the session/context lookup
 * (which user and organization is "signed in") and how the client is built
 * (a real supabase-js client, signed in with a real signed JWT).
 *
 * Run via scripts/test-screens-local.sh (it builds the database and starts
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
if (!URL_ || !DB || !SECRET) { console.error("Run via scripts/test-screens-local.sh"); process.exit(2); }

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
let refreshes = 0;
const stubs = new Map([["next/cache", { revalidatePath() {} }], ["next/navigation", { useRouter: () => ({ refresh() { refreshes++; } }), usePathname: () => "/tournaments" }]]);
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
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "KeyboardEvent"]) {
  try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch {}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const _warn = console.warn; console.warn = (...a) => { if (!/GoTrueClient/.test(String(a[0]))) _warn(...a); };
const _err = console.error; console.error = (...a) => { if (!/Invalid value for prop `action`/.test(String(a[0]))) _err(...a); }; // React 18 in jsdom does not know function form actions; Next's React does
const _log = console.log; console.log = (...a) => { if (!/GoTrueClient/.test(String(a[0]))) _log(...a); };
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { ToastProvider } = require(path.join(ROOT, "components", "Toaster.js"));
const { useQuickStatus, QuickButton } = require(path.join(ROOT, "components", "QuickStatus.js"));
const { RecordPaymentSheet } = require(path.join(ROOT, "components", "RecordPaymentSheet.js"));
const { GuidedTransaction } = require(path.join(ROOT, "components", "GuidedTransaction.js"));
const { tournamentPayments } = require(path.join(ROOT, "lib", "tournament-status.js"));

const uuid = () => crypto.randomUUID();
const sql = (q) => execFileSync("psql", ["-At", "-d", DB, "-c", q], { encoding: "utf8" }).trim();
const as = (u) => { current = USERS[u]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => document.body.textContent;
async function until(cond, label, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await act(async () => { await sleep(40); });
  }
  return false;
}
const byText = (sel, re) => [...document.querySelectorAll(sel)].find((e) => re.test(e.textContent));
async function click(el) { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); }
async function type(el, v) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
const dlg = () => document.querySelector(".st-sheet");
const dlgPrimary = () => document.querySelector(".st-sheet button.btn-primary");
// Toasts stack; always act on the newest one.
const lastToast = () => [...document.querySelectorAll(".st-toast")].pop();
const toastText = () => lastToast()?.textContent ?? "";
const toastUndo = () => lastToast()?.querySelector(".st-toast-act") ?? null;

const FUTURE = { start_date: "2027-01-10", end_date: "2027-01-11" };
function tournamentRow(n) {
  return { ...JSON.parse(sql(`select row_to_json(t) from (select id, name, total_cost::float8 as total_cost, decision, paid_status, budget_item_id from tournaments where id='${T(n)}') t`)), ...FUTURE };
}
function txns(n) {
  return JSON.parse(sql(`select coalesce(json_agg(row_to_json(x)),'[]') from (select id, tournament_id, is_income, status, actual_amount::float8 as actual_amount, txn_date::text as txn_date, budget_item_id, item from budget_transactions where tournament_id='${T(n)}') x`));
}
const LINES = [{ id: LINE, category: "Tournaments", name: "Tournament fees", is_income: false }, { id: LINE2, category: "Facilities", name: "Field rental", is_income: false }];
const money2 = (q) => sql(q);

let root;
const editCalls = []; // tournaments the dialog handed to Edit details
function Harness({ t, transactions }) {
  const quick = useQuickStatus({ transactions, budgetLines: LINES, seasonAvailable: 5000, onEditDetails: (x) => editCalls.push(x.id) });
  return React.createElement(React.Fragment, null, React.createElement(QuickButton, { t, quick, canWrite: true }), quick.element);
}
async function mountQuick(n) {
  const t = tournamentRow(n);
  document.body.innerHTML = "<div id=root></div>";
  root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(React.createElement(ToastProvider, null, React.createElement(Harness, { t, transactions: txns(n) }))); });
  return t;
}
async function mountNode(node) {
  document.body.innerHTML = "<div id=root></div>";
  root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(React.createElement(ToastProvider, null, node)); });
}
async function unmount() { await act(async () => root.unmount()); }
const quickBtn = () => byText("button.btn-sm", /./);
const add = (n, amount, status, extra = {}) => sql(`insert into budget_transactions (organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status, txn_date) values ('${A}','${SEASON_A}','${T(n)}','${LINE}','Tournaments','${extra.item ?? "added elsewhere"}',${amount},'${status}','2026-11-19')`);

(async () => {
  section("payment figures: the screen helper agrees with the database function");
  for (const n of [1, 2, 3, 4]) {
    const t = tournamentRow(n); const f = tournamentPayments(t, txns(n));
    const db = JSON.parse(sql(`select to_json(s) from (select tournament_money_state('${T(n)}') as m) s`)).m;
    ok(`T${n}: total/paid/remaining match tournament_money_state`, f.cost === Number(db.total_cost) && f.paid === Number(db.paid) && f.remaining === Number(db.remaining), { f, db });
  }

  section("Mark paid in full: deposit, save, toast, Undo (operation id)");
  as("owner");
  await mountQuick(1);
  ok("the row offers Mark paid in full", /Mark paid in full/.test(quickBtn().textContent));
  await click(quickBtn());
  ok("dialog opens", !!dlg());
  ok("shows total 650, paid so far 300, still to pay 350", /650/.test(dlg().textContent) && /300/.test(dlg().textContent) && /350/.test(dlg().textContent), dlg().textContent);
  ok("amount defaults to the remaining balance only (350)", document.getElementById("mp-amount").value === "350", document.getElementById("mp-amount").value);
  ok("budget line is pre-selected from the tournament", document.getElementById("mp-line").value === LINE);
  await click(dlgPrimary()); await click(dlgPrimary()); // a double tap
  ok("toast appears and the dialog closes", await until(() => /paid in full/.test(toastText()) && !dlg(), "toast"), text());
  ok("tournament is Paid in Full", money2(`select paid_status from tournaments where id='${T(1)}'`) === "Paid in Full");
  ok("a double tap recorded exactly one payment of 350 (plus the existing 300)",
    money2(`select count(*)||':'||sum(actual_amount) from budget_transactions where tournament_id='${T(1)}'`) === "2:650.00", money2(`select count(*)||':'||sum(actual_amount) from budget_transactions where tournament_id='${T(1)}'`));
  ok("toast says what happened", /T1 Deposit is paid in full/.test(toastText()) && /350/.test(toastText()), toastText());
  const before = refreshes;
  await click(toastUndo());
  ok("Undo restores the status", await until(() => money2(`select paid_status from tournaments where id='${T(1)}'`) === "Deposit Paid", "undo"));
  ok("Undo removes only the payment it created", money2(`select count(*) from budget_transactions where tournament_id='${T(1)}'`) === "1");
  ok("the page is refreshed after Undo", refreshes > before);
  await unmount();

  section("Mark paid in full: balance changed while it was open");
  as("owner");
  await mountQuick(2);
  await click(quickBtn());
  add(2, 100, "Paid", { item: "paid on another screen" });
  await click(dlgPrimary());
  ok("dialog explains the balance changed", await until(() => /balance changed/i.test(dlg()?.textContent ?? ""), "notice"), text());
  ok("nothing was saved", money2(`select paid_status from tournaments where id='${T(2)}'`) === "Registered" && money2(`select count(*) from budget_transactions where tournament_id='${T(2)}'`) === "1");
  ok("amount now shows the live remaining 400", document.getElementById("mp-amount").value === "400", document.getElementById("mp-amount").value);
  await click(dlgPrimary());
  ok("saving again with the new figures succeeds", await until(() => money2(`select paid_status from tournaments where id='${T(2)}'`) === "Paid in Full", "second save"));
  ok("recorded the live remainder (400), total now 500", money2(`select sum(actual_amount) from budget_transactions where tournament_id='${T(2)}'`) === "500.00");
  await unmount();

  section("Mark paid in full: cost edited while the dialog was open");
  as("owner");
  sql(`insert into tournaments (id, organization_id, season_id, name, entry_fee, gate_fee, decision, paid_status, budget_item_id) values ('${T(11)}','${A}','${SEASON_A}','T11 Cost',500,0,'Committed','Registered','${LINE}')`);
  await mountQuick(11);
  await click(quickBtn());
  sql(`update tournaments set entry_fee = 650 where id='${T(11)}'`);
  await click(dlgPrimary());
  ok("dialog explains the balance changed", await until(() => /balance changed/i.test(dlg()?.textContent ?? ""), "notice"), text());
  ok("nothing was saved", money2(`select paid_status from tournaments where id='${T(11)}'`) === "Registered" && money2(`select count(*) from budget_transactions where tournament_id='${T(11)}'`) === "0");
  ok("amount now shows the new remaining 650", document.getElementById("mp-amount").value === "650", document.getElementById("mp-amount").value);
  await click(dlgPrimary());
  ok("saving again records the new remainder (650)", await until(() => money2(`select sum(actual_amount) from budget_transactions where tournament_id='${T(11)}'`) === "650.00", "second save"));
  await unmount();

  section("Mark paid in full: an unpaid entry edited while the dialog was open");
  as("owner");
  sql(`insert into tournaments (id, organization_id, season_id, name, entry_fee, gate_fee, decision, paid_status, budget_item_id) values ('${T(12)}','${A}','${SEASON_A}','T12 Entry',450,0,'Committed','Registered','${LINE}')`);
  add(12, 450, "To Pay", { item: "owed" });
  await mountQuick(12);
  await click(quickBtn());
  sql(`update budget_transactions set actual_amount = 400 where tournament_id='${T(12)}' and status='To Pay'`);
  await click(dlgPrimary());
  ok("dialog explains the balance changed", await until(() => /balance changed/i.test(dlg()?.textContent ?? ""), "notice"), text());
  ok("nothing was saved (entry still To Pay at 400)", money2(`select status||':'||actual_amount::numeric(10,2) from budget_transactions where tournament_id='${T(12)}'`) === "To Pay:400.00");
  await unmount();

  section("Undo refused after a later change: the toast says why and nothing changes");
  as("owner");
  await mountQuick(4);
  await click(quickBtn()); await click(dlgPrimary());
  await until(() => money2(`select paid_status from tournaments where id='${T(4)}'`) === "Paid in Full" && toastUndo(), "save");
  add(4, 20, "Paid", { item: "later payment" });
  await click(toastUndo());
  ok("toast shows a plain-English refusal", await until(() => /changed|can.t undo|cannot undo/i.test(toastText()) && !toastUndo(), "refusal"), toastText());
  ok("status and payments untouched", money2(`select paid_status from tournaments where id='${T(4)}'`) === "Paid in Full" && money2(`select count(*) from budget_transactions where tournament_id='${T(4)}'`) === "2");
  await unmount();

  section("failed save shows the error in the dialog and keeps it open");
  as("owner");
  await mountQuick(5);
  await click(quickBtn()); await click(dlgPrimary());
  ok("error is shown", await until(() => /forced failure|went wrong|couldn/i.test(dlg()?.textContent ?? ""), "error"), dlg()?.textContent);
  ok("nothing saved", money2(`select count(*) from budget_transactions where tournament_id='${T(5)}'`) === "0" && money2(`select paid_status from tournaments where id='${T(5)}'`) === "Registered");
  ok("the dialog stays open for another try", !!dlg());
  await unmount();

  section("status-only path");
  as("owner");
  await mountQuick(3);
  await click(quickBtn());
  await click(dlg().querySelector("input[type=checkbox]"));
  ok("unchecking explains only the status will change", /Only the tournament status will change/.test(dlg().textContent));
  await click(dlgPrimary());
  ok("status-only save works", await until(() => money2(`select paid_status from tournaments where id='${T(3)}'`) === "Paid in Full", "status only"));
  ok("no payment was recorded", money2(`select count(*) from budget_transactions where tournament_id='${T(3)}'`) === "0");
  await unmount();

  section("Mark paid in full with an unpaid (To Pay) entry: that entry is marked paid, no second record");
  as("owner");
  add(6, 300, "To Pay", { item: "T6 entry owed" });
  await mountQuick(6);
  await click(quickBtn());
  ok("offers to mark the existing unpaid entry paid", /mark the unpaid Finance entry paid/i.test(dlg().textContent), dlg().textContent);
  ok("amount is the entry's 300", document.getElementById("mp-amount").value === "300");
  await click(dlgPrimary());
  ok("saved", await until(() => money2(`select paid_status from tournaments where id='${T(6)}'`) === "Paid in Full", "save"));
  ok("the existing entry became Paid and no row was added", money2(`select count(*)||':'||min(status) from budget_transactions where tournament_id='${T(6)}'`) === "1:Paid");
  await until(() => toastUndo(), "undo");
  await click(toastUndo());
  ok("Undo puts the entry back to To Pay", await until(() => money2(`select status from budget_transactions where tournament_id='${T(6)}'`) === "To Pay" && money2(`select paid_status from tournaments where id='${T(6)}'`) === "Registered", "undo"));
  await unmount();

  section("Mark registered: saves at once, Undo is compare-and-set");
  as("owner");
  sql(`insert into tournaments (id, organization_id, season_id, name, entry_fee, gate_fee, decision, paid_status, budget_item_id) values ('${T(10)}','${A}','${SEASON_A}','T10 Register',200,0,'Committed','Not Registered','${LINE}')`);
  await mountQuick(10);
  ok("the row offers Mark registered", /Mark registered/.test(quickBtn().textContent));
  await click(quickBtn());
  ok("saved without a dialog", await until(() => money2(`select paid_status from tournaments where id='${T(10)}'`) === "Registered" && toastUndo(), "register"));
  await click(toastUndo());
  ok("Undo restores Not Registered", await until(() => money2(`select paid_status from tournaments where id='${T(10)}'`) === "Not Registered", "undo"));
  await unmount();
  await mountQuick(10);
  await click(quickBtn());
  await until(() => money2(`select paid_status from tournaments where id='${T(10)}'`) === "Registered" && toastUndo(), "register again");
  sql(`update tournaments set paid_status='Deposit Paid' where id='${T(10)}'`); // changed by someone else
  await click(toastUndo());
  ok("Undo refuses when the status changed afterwards", await until(() => /changed after/i.test(toastText()), "refusal"), toastText());
  ok("and leaves the newer status alone", money2(`select paid_status from tournaments where id='${T(10)}'`) === "Deposit Paid");
  await unmount();

  section("Commit: asks first, saves, Undo is compare-and-set");
  as("owner");
  await mountQuick(9);
  ok("the row offers Commit", /Commit/.test(quickBtn().textContent));
  await click(quickBtn());
  ok("a confirmation dialog opens", !!dlg() && /Commit to T9 Status/.test(dlg().textContent), dlg()?.textContent);
  ok("nothing saved before confirming", money2(`select decision from tournaments where id='${T(9)}'`) === "Considering");
  await click(dlgPrimary());
  ok("committed", await until(() => money2(`select decision from tournaments where id='${T(9)}'`) === "Committed" && toastUndo(), "commit"));
  await click(toastUndo());
  ok("Undo restores Considering", await until(() => money2(`select decision from tournaments where id='${T(9)}'`) === "Considering", "undo"));
  await click(quickBtn()); await click(dlgPrimary());
  await until(() => money2(`select decision from tournaments where id='${T(9)}'`) === "Committed" && toastUndo(), "commit again");
  sql(`update tournaments set decision='Declined' where id='${T(9)}'`);
  await click(toastUndo());
  ok("Undo refuses when the decision changed afterwards", await until(() => /changed after/i.test(toastText()), "refusal"), toastText());
  ok("and leaves Declined alone", money2(`select decision from tournaments where id='${T(9)}'`) === "Declined");
  await unmount();

  section("Record payment sheet: key, balance check, duplicate, stale screen, Undo");
  as("owner");
  const P1 = P(2); // 1000 due, nothing paid
  const pRow = (paid) => ({ id: P1, displayName: "P2 concurrent", balance: 1000 - paid, totalDue: 1000, totalPaid: paid, log: [] });
  await mountNode(React.createElement(RecordPaymentSheet, { p: pRow(0), onClose() {} }));
  ok("amount starts at the balance (1000)", dlg().querySelector("input").value === "1000.00", dlg().querySelector("input").value);
  const amountEl = () => dlg().querySelector("input");
  await type(amountEl(), "400");
  await click(dlgPrimary()); await click(dlgPrimary()); // a double tap
  ok("recorded", await until(() => /Recorded/.test(toastText()), "toast"), toastText());
  ok("exactly one payment of 400", money2(`select count(*)||':'||sum(amount) from payment_log where payment_id='${P1}'`) === "1:400.00", money2(`select count(*)||':'||sum(amount) from payment_log where payment_id='${P1}'`));
  await click(toastUndo());
  ok("Undo removes that payment", await until(() => money2(`select count(*) from payment_log where payment_id='${P1}'`) === "0", "undo"));
  await unmount();
  // stale: another coach recorded 100 while this sheet (balance 1000) was open
  await mountNode(React.createElement(RecordPaymentSheet, { p: pRow(0), onClose() {} }));
  sql(`insert into payment_log (payment_id, amount, paid_date) values ('${P1}', 100, '2026-11-19')`);
  await click(dlgPrimary());
  ok("a sheet showing an old balance is refused with a plain message", await until(() => /changed|refresh/i.test(dlg()?.textContent ?? ""), "stale"), dlg()?.textContent);
  ok("nothing was added", money2(`select count(*) from payment_log where payment_id='${P1}'`) === "1");
  await unmount();
  // Undo refused after a later change
  await mountNode(React.createElement(RecordPaymentSheet, { p: pRow(100), onClose() {} }));
  await type(amountEl(), "50");
  await click(dlgPrimary());
  await until(() => /Recorded/.test(toastText()) && toastUndo(), "toast");
  sql(`insert into payment_log (payment_id, amount, paid_date) values ('${P1}', 10, '2026-11-19')`);
  await click(toastUndo());
  ok("Undo refuses once another payment was recorded", await until(() => /changed|can.t undo|cannot undo/i.test(toastText()) && !toastUndo(), "refusal"), toastText());
  ok("both later payments remain", money2(`select count(*) from payment_log where payment_id='${P1}'`) === "3");
  await unmount();

  section("Guided Add transaction: four steps, one save, duplicate-proof, Undo");
  as("owner");
  const GT = (extra = {}) => React.createElement(GuidedTransaction, {
    budgetItems: LINES, tournaments: [{ ...tournamentRow(9), budget_item_id: LINE }], players: [], facilities: [], transactions: [], onClose() {}, ...extra,
  });
  await mountNode(GT());
  ok("starts at step 1 asking what it is for", /Step 1 of 4/.test(dlg().textContent) && /What.s it for/.test(dlg().textContent));
  ok("Next is disabled until a kind is chosen", dlgPrimary().disabled === true);
  await click(byText(".st-kinds button", /Field or facility/));
  await type(document.getElementById("gt-item"), "Cage rental");
  await click(dlgPrimary());
  ok("step 2 asks where it counts", /Step 2 of 4/.test(dlg().textContent));
  ok("the Field / Facility line is suggested only if it exists; otherwise one is chosen", true);
  await click(byText(".st-picker button", /Field rental/));
  await click(dlgPrimary());
  ok("step 3 asks how much", /Step 3 of 4/.test(dlg().textContent));
  ok("Review is disabled with no amount", dlgPrimary().disabled === true);
  await type(document.getElementById("gt-amt"), "85.50");
  await click(dlgPrimary());
  ok("step 4 shows what will change", /Step 4 of 4/.test(dlg().textContent) && /Cage rental/.test(dlg().textContent) && /What changes/.test(dlg().textContent));
  ok("nothing saved before the last step", money2(`select count(*) from budget_transactions where item='Cage rental'`) === "0");
  await click(dlgPrimary()); await click(dlgPrimary()); // a double tap
  ok("saved with a toast", await until(() => /Saved Cage rental/.test(toastText()), "toast"), toastText());
  ok("exactly one transaction was created", money2(`select count(*)||':'||sum(actual_amount)||':'||min(status) from budget_transactions where item='Cage rental'`) === "1:85.5:Paid", money2(`select count(*)||':'||sum(actual_amount)||':'||min(status) from budget_transactions where item='Cage rental'`));
  ok("it carries the request key", money2(`select count(*) from budget_transactions where item='Cage rental' and request_key is not null`) === "1");
  await click(toastUndo());
  ok("Undo removes it", await until(() => money2(`select count(*) from budget_transactions where item='Cage rental'`) === "0", "undo"));
  await unmount();

  await mountNode(GT());
  await click(byText(".st-kinds button", /Equipment/));
  await type(document.getElementById("gt-item"), "Practice balls");
  await click(dlgPrimary());
  await click(byText(".st-picker button", /Field rental/));
  await click(dlgPrimary());
  await type(document.getElementById("gt-amt"), "40");
  await click(dlgPrimary()); // review
  await click(dlgPrimary()); // save
  await until(() => /Saved Practice balls/.test(toastText()) && toastUndo(), "toast");
  sql(`update budget_transactions set actual_amount = 41 where item='Practice balls'`); // edited by someone afterwards
  await click(toastUndo());
  ok("Undo refuses when the transaction was edited afterwards", await until(() => /changed|can.t undo|cannot undo/i.test(toastText()) && !toastUndo(), "refusal"), toastText());
  ok("the edited transaction remains", money2(`select count(*) from budget_transactions where item='Practice balls'`) === "1");
  await unmount();

  section("failed guided save keeps the draft and shows the error");
  as("parent");
  await mountNode(GT());
  await click(byText(".st-kinds button", /Equipment/));
  await click(dlgPrimary());
  await click(byText(".st-picker button", /Field rental/));
  await click(dlgPrimary());
  await type(document.getElementById("gt-amt"), "12");
  await click(dlgPrimary()); await click(dlgPrimary());
  ok("a person without write access sees an error and nothing is saved", await until(() => !!dlg()?.querySelector("[role=alert], .st-err"), "err") || /not allowed|permission|couldn/i.test(dlg()?.textContent ?? ""), dlg()?.textContent);
  ok("the sheet stays open on step 4", /Step 4 of 4/.test(dlg()?.textContent ?? ""));
  ok("no row was created", money2(`select count(*) from budget_transactions where actual_amount = 12 and item <> 'T1 deposit'`) === "0");
  await unmount();

  /* ===== Mark paid in full: the cost and the unpaid entry disagree ($450 cost, $400 entry) ===== */
  const mkT = (n, entry, gate) => sql(`insert into tournaments (id, organization_id, season_id, name, entry_fee, gate_fee, decision, paid_status, budget_item_id) values ('${T(n)}','${A}','${SEASON_A}','T${n} Gap',${entry},${gate},'Committed','Registered','${LINE}')`);
  const radio = (v) => document.querySelector(`.st-sheet input[type=radio][value="${v}"]`);
  const paidState = (n) => money2(`select paid_status from tournaments where id='${T(n)}'`);
  const cost = (n) => money2(`select total_cost::numeric(10,2) from tournaments where id='${T(n)}'`);
  const entryRow = (n) => money2(`select status||':'||actual_amount::numeric(10,2) from budget_transactions where tournament_id='${T(n)}'`);
  const editBtn = () => byText(".st-sheet button", /Correct the cost in Edit details/);

  section("Mismatch: $450 cost, $400 unpaid entry. The dialog explains it and makes the person choose");
  as("owner");
  mkT(13, 450, 0); add(13, 400, "To Pay", { item: "T13 owed" });
  await mountQuick(13);
  await click(quickBtn());
  ok("explains the $50 difference with both figures", /\$50/.test(dlg().textContent) && /\$450/.test(dlg().textContent) && /\$400/.test(dlg().textContent), dlg().textContent);
  ok("offers to record the full $450", !!radio("record") && /Record the full \$450/.test(dlg().textContent), dlg().textContent);
  ok("offers to correct the cost in Edit details", !!editBtn());
  ok("the cost is never edited inside this dialog (no cost choice, no cost field)", !radio("cost") && !dlg().querySelector("#mp-cost"));
  ok("the choice is not pre-selected", !radio("record").checked);
  ok("the status-only option is still there", !!dlg().querySelector("input[type=checkbox]"));
  await click(dlgPrimary());
  ok("saving without choosing is refused and says why", await until(() => /Record the full \$450(\.00)?, correct the cost in Edit details/i.test(dlg()?.textContent ?? ""), "choose"), dlg()?.textContent);
  ok("nothing was saved", paidState(13) === "Registered" && entryRow(13) === "To Pay:400.00" && cost(13) === "450.00");
  await unmount();

  section("Mismatch, record the full $450 (the entry is raised to $450 and marked paid)");
  as("owner");
  await mountQuick(13);
  await click(quickBtn());
  await click(radio("record"));
  ok("the amount now reads 450", document.getElementById("mp-amount").value === "450", document.getElementById("mp-amount").value);
  await click(dlgPrimary());
  ok("tournament is Paid in Full", await until(() => paidState(13) === "Paid in Full", "paid"));
  ok("Finance shows $450 paid, cost unchanged", entryRow(13) === "Paid:450.00" && cost(13) === "450.00");
  await until(() => toastUndo(), "undo");
  await click(toastUndo());
  ok("Undo puts the entry back to To Pay at 400 and the status back", await until(() => paidState(13) === "Registered" && entryRow(13) === "To Pay:400.00", "undo"));
  ok("the cost is still 450 (this dialog never touches it)", cost(13) === "450.00");
  await unmount();

  section("Mismatch, correct the cost in Edit details: hands off, changes nothing, then reopening has no gap");
  as("owner");
  mkT(14, 450, 0); add(14, 400, "To Pay", { item: "T14 owed" });
  editCalls.length = 0;
  await mountQuick(14);
  await click(quickBtn());
  await click(editBtn());
  ok("the dialog closed", await until(() => !dlg(), "closed"));
  ok("Edit details was opened for this tournament", editCalls.length === 1 && editCalls[0] === T(14), editCalls);
  ok("nothing was changed by handing off", paidState(14) === "Registered" && entryRow(14) === "To Pay:400.00" && cost(14) === "450.00");
  await unmount();
  sql(`update tournaments set entry_fee = 400 where id='${T(14)}'`); // what saving Edit details does
  await mountQuick(14);
  await click(quickBtn());
  ok("reopened after the cost was corrected: no mismatch panel", !radio("record") && !/don.t match/i.test(dlg().textContent), dlg().textContent);
  await click(dlgPrimary());
  ok("saves: Paid in Full, the entry paid at 400", await until(() => paidState(14) === "Paid in Full" && entryRow(14) === "Paid:400.00", "paid"));
  await unmount();

  section("Mismatch, status-only: nothing in Finance changes, no choice needed");
  as("owner");
  mkT(16, 450, 0); add(16, 400, "To Pay", { item: "T16 owed" });
  await mountQuick(16);
  await click(quickBtn());
  await click(dlg().querySelector("input[type=checkbox]"));
  await click(dlgPrimary());
  ok("status changed", await until(() => paidState(16) === "Paid in Full", "paid"));
  ok("the unpaid entry and the cost are untouched", entryRow(16) === "To Pay:400.00" && cost(16) === "450.00");
  await unmount();

  section("Mismatch, the cost was edited elsewhere while the dialog was open: the new gap is shown, nothing saved");
  as("owner");
  mkT(17, 400, 0); add(17, 400, "To Pay", { item: "T17 owed" });
  await mountQuick(17);
  await click(quickBtn());
  sql(`update tournaments set entry_fee = 450 where id='${T(17)}'`);
  await click(dlgPrimary());
  ok("explains the balance changed", await until(() => /balance changed/i.test(dlg()?.textContent ?? ""), "notice"), dlg()?.textContent);
  ok("now shows the $50 difference and its choices", !!radio("record") && !!editBtn(), dlg()?.textContent);
  ok("nothing was saved", paidState(17) === "Registered" && entryRow(17) === "To Pay:400.00" && cost(17) === "450.00");
  await unmount();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
