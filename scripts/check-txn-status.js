/**
 * Transaction statuses and the Finance figures they drive — BEHAVIOURAL.
 *
 * Statuses are To Pay | Paid (2026-11; replaced Planned | Ordered | Received |
 * Paid). These checks run the real Finance code over small fixtures and assert
 * the numbers a coach sees, not the source text:
 *
 *   A. the status vocabulary and transactionStatusFor(), the one save rule
 *   B. Paid, To Pay, Available and Total Committed for each status
 *   C. tournament commitments (the larger of cost and recorded, never the sum)
 *      and Projected Available — unchanged rules, locked here
 *   D. income: always Paid, counted in Money In, never in expense figures
 *   E. the sentence the transaction drawer shows for each case
 *   F. saveTransaction, run against an in-memory database: what is written
 *   G. the transaction form and list, rendered
 *   H. the pending migration's mapping and guards
 *
 * Same harness as check-dues-edit.js: SWC from Next.js compiles on the fly,
 * framework and database modules are stand-ins, no network or database.
 */

const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
let passed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}

/* ---------------- module loading ---------------- */

const STUB_DIR = path.join(ROOT, "scripts", "__txn_stubs__");
const stubs = new Map();
function stub(name, exportsObj) { stubs.set(name, exportsObj); }

let db = null;
stub("next/cache", { revalidatePath() {} });
stub("next/headers", { cookies() { return { get() {}, set() {} }; }, headers() { return new Map(); } });
stub("next/navigation", {
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/finance",
  redirect() { throw new Error("redirect"); },
  notFound() { throw new Error("notFound"); },
});
stub("next/link", { __esModule: true, default: (props) => require("react").createElement("a", props, props.children) });
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const CONTEXT = path.join(ROOT, "lib", "context.js");

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (stubs.has(request)) return `${STUB_DIR}/${request}`;
  return origResolve.call(this, request, parent, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  const resolved = (() => { try { return Module._resolveFilename(request, parent); } catch { return null; } })();
  if (resolved === SUPABASE_SERVER) return { createClient: () => db };
  if (resolved === CONTEXT) {
    return {
      requireSeasonContext: async () => ({
        profile: { role: "owner" }, organization: { id: "org-1" }, season: { id: "season-1" },
      }),
      canWrite: () => true,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const swc = require("next/dist/build/swc");
const SWC_OPTS = {
  jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" },
  module: { type: "commonjs" },
};
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(module, filename);
  let src = fs.readFileSync(filename, "utf8");
  if (filename === path.join(ROOT, "components", "FinanceClient.js")) {
    src += "\nexport { TransactionForm as __TransactionForm, TransactionDetail as __TransactionDetail };\n";
  }
  const { code } = swc.transformSync(src, { ...SWC_OPTS, filename });
  module._compile(code, filename);
};

const rules = require(path.join(ROOT, "lib", "finance-rules.js"));
const q = require(path.join(ROOT, "lib", "queries", "finance.js"));

/* ---------------- fixtures ---------------- */

const LINE = { id: "L1", category: "Player Uniforms", name: "Game uniforms", budgeted: 1000, is_income: false };
const TOURN_LINE = { id: "LT", category: "Tournament Fees", name: "Entry fees", budgeted: 5000, is_income: false };
const INCOME_LINE = { id: "LI", category: "Fundraising", name: "Car wash", budgeted: 800, is_income: true };
let seq = 0;
const txn = (status, amount, extra = {}) => ({
  id: `t${++seq}`, status, actual_amount: amount, is_income: false, budget_item_id: "L1",
  tournament_id: null, category: "Player Uniforms", ...extra,
});

/** Every figure a coach reads, for one season. */
function figures(transactions, { items = [LINE], tournaments = [], payments = [] } = {}) {
  const withLines = transactions.map((t) => ({ ...t, budget_item: items.find((i) => i.id === t.budget_item_id) ?? null }));
  const budget = q.buildBudget(items, withLines, tournaments);
  const s = q.financeSummary(budget, withLines, payments);
  const unassigned = q.unassignedTournamentCommitments(tournaments);
  const unassignedTotal = rules.sumMoney(unassigned.map((t) => t.amount));
  return {
    paid: s.actualExpenses,
    committedUnpaid: s.committedUnpaid,
    toPay: s.toPay,
    available: s.availableBudget,
    committed: s.committedExpenses,
    projectedAvailable: rules.sumMoney([s.availableBudget, -unassignedTotal]),
    moneyIn: q.fundsIn(withLines, payments, items).total,
    actualIncome: s.actualIncome,
    categories: budget.expenses.map((g) => ({ category: g.category, paid: g.paidTotal, toPay: g.toPay, available: g.available, committed: g.committedTotal })),
  };
}
const core = (f) => ({ paid: f.paid, toPay: f.toPay, available: f.available, committed: f.committed });

/* ---------------- A. vocabulary and the save rule ---------------- */

console.log("A. statuses and transactionStatusFor");
assertEq("expense statuses are exactly To Pay and Paid", rules.TXN_STATUSES, ["To Pay", "Paid"]);
assertEq("new expenses default to Paid", rules.DEFAULT_TXN_STATUS, "Paid");
const sf = (isIncome, submitted) => rules.transactionStatusFor({ isIncome, submitted });
assertEq("expense with no status submitted saves as Paid", sf(false, null), { status: "Paid" });
assertEq("expense with a blank status saves as Paid", sf(false, "  "), { status: "Paid" });
assertEq("expense To Pay saves as To Pay", sf(false, "To Pay"), { status: "To Pay" });
assertEq("expense Paid saves as Paid", sf(false, "Paid"), { status: "Paid" });
for (const old of ["Planned", "Ordered", "Received", "to pay", "Pending"]) {
  assertEq(`expense "${old}" is refused, not stored`, sf(false, old), { error: "Choose To Pay or Paid." });
}
assertEq("income is Paid whatever was submitted (To Pay)", sf(true, "To Pay"), { status: "Paid" });
assertEq("income is Paid with no status submitted", sf(true, null), { status: "Paid" });
assertEq("income is Paid even with a retired status", sf(true, "Planned"), { status: "Paid" });

/* ---------------- B. the figures each status drives ---------------- */

console.log("B. Paid, To Pay, Available, Total Committed ($1,000 budget line)");
assertEq("nothing recorded: all available",
  core(figures([])), { paid: 0, toPay: 0, available: 1000, committed: 0 });
assertEq("To Pay $300: committed and to pay, not paid, Available reduced",
  core(figures([txn("To Pay", 300)])), { paid: 0, toPay: 300, available: 700, committed: 300 });
assertEq("Paid $300: paid, inside committed, nothing to pay, Available reduced",
  core(figures([txn("Paid", 300)])), { paid: 300, toPay: 0, available: 700, committed: 300 });
assertEq("To Pay $200 + Paid $100: Paid is a subset of Committed, never added to it",
  core(figures([txn("To Pay", 200), txn("Paid", 100)])), { paid: 100, toPay: 200, available: 700, committed: 300 });
{
  const f = figures([txn("To Pay", 200), txn("Paid", 100)]);
  assertEq("Budget = Paid + To Pay + Available, to the cent",
    rules.cents(f.paid) + rules.cents(f.toPay) + rules.cents(f.available), rules.cents(1000));
  assertEq("the category row shows the same four figures",
    f.categories, [{ category: "Player Uniforms", paid: 100, toPay: 200, available: 700, committed: 300 }]);
}
assertEq("committed-but-unpaid (financeSummary.committedUnpaid) is To Pay only",
  [figures([txn("To Pay", 200), txn("Paid", 100)]).committedUnpaid, figures([txn("Paid", 100)]).committedUnpaid], [200, 0]);
assertEq("isCommittedUnpaid / isFinanciallyRecorded / isActual by status",
  ["To Pay", "Paid"].map((st) => [rules.isCommittedUnpaid(txn(st, 5)), rules.isFinanciallyRecorded(txn(st, 5)), rules.isActual(txn(st, 5))]),
  [[true, true, false], [false, true, true]]);
assertEq("marking a To Pay bill Paid moves it from To Pay to Paid; Committed and Available stay put",
  [core(figures([txn("To Pay", 450)])), core(figures([txn("Paid", 450)]))],
  [{ paid: 0, toPay: 450, available: 550, committed: 450 }, { paid: 450, toPay: 0, available: 550, committed: 450 }]);
assertEq("To Pay with no amount counts toward nothing",
  core(figures([txn("To Pay", null)])), { paid: 0, toPay: 0, available: 1000, committed: 0 });
assertEq("Paid with no amount counts toward nothing",
  core(figures([txn("Paid", null)])), { paid: 0, toPay: 0, available: 1000, committed: 0 });
assertEq("a retired or unknown status never consumes budget",
  core(figures([txn("Ordered", 300), txn("Planned", 50), txn("Received", 70)])), { paid: 0, toPay: 0, available: 1000, committed: 0 });
assertEq("over-commitment is shown as negative Available, never floored",
  core(figures([txn("To Pay", 1200.5)])), { paid: 0, toPay: 1200.5, available: -200.5, committed: 1200.5 });
assertEq("cents stay exact (3 x $33.33 To Pay)",
  core(figures([txn("To Pay", 33.33), txn("To Pay", 33.33), txn("To Pay", 33.33)])), { paid: 0, toPay: 99.99, available: 900.01, committed: 99.99 });
{
  const line = q.buildBudget([LINE], [txn("To Pay", 250), txn("Paid", 150)], []).expenses[0].rows[0];
  assertEq("the budget line row: Paid, To Pay, Available, committed",
    { paid: line.actual, toPay: line.toPay, available: line.available, committed: line.committedTotal },
    { paid: 150, toPay: 250, available: 600, committed: 400 });
  assertEq("the tournament drawer's line context reads the same rule",
    rules.budgetLineFinance(LINE, [txn("To Pay", 250), txn("Paid", 150)], []),
    { planned: 1000, committed: 400, paid: 150, available: 600, percentCommitted: 40 });
}

/* ---------------- C. tournament commitments and Projected Available ---------------- */

console.log("C. tournament commitments (unchanged rules)");
{
  const items = [TOURN_LINE];
  const T = { id: "T1", decision: "Committed", total_cost: 555, budget_item_id: "LT" };
  const onT = (status, amount) => txn(status, amount, { budget_item_id: "LT", tournament_id: "T1", category: "Tournament Fees" });
  assertEq("committed $555 tournament, nothing recorded: $555 committed and to pay",
    core(figures([], { items, tournaments: [T] })), { paid: 0, toPay: 555, available: 4445, committed: 555 });
  assertEq("...$495 Paid against it: the larger of cost and recorded, never the sum",
    core(figures([onT("Paid", 495)], { items, tournaments: [T] })), { paid: 495, toPay: 60, available: 4445, committed: 555 });
  assertEq("...$495 Paid + $60 Paid: still $555, not $1,110",
    core(figures([onT("Paid", 495), onT("Paid", 60)], { items, tournaments: [T] })), { paid: 555, toPay: 0, available: 4445, committed: 555 });
  assertEq("...$600 To Pay exceeds the cost: commitment rises to what is recorded",
    core(figures([onT("To Pay", 600)], { items, tournaments: [T] })), { paid: 0, toPay: 600, available: 4400, committed: 600 });
  assertEq("tournamentCommitment counts To Pay and Paid toward recorded",
    [rules.tournamentCommitment(T, [onT("To Pay", 300), onT("Paid", 400)]), rules.tournamentCommitment(T, [onT("To Pay", 100)])],
    [700, 555]);
  assertEq("a Considering tournament commits nothing",
    rules.tournamentCommitment({ ...T, decision: "Considering" }, [onT("Paid", 400)]), 0);
  assertEq("Budget tab 'paid against tournaments' counts Paid only",
    rules.tournamentPaidTotal([onT("Paid", 495), onT("To Pay", 60)]), 495);

  const unassigned = { id: "T2", name: "Fall Classic", decision: "Committed", total_cost: 800, budget_item_id: null };
  const f = figures([onT("To Pay", 100)], { items, tournaments: [T, unassigned] });
  assertEq("an unassigned committed tournament is outside Available but inside Projected Available",
    { available: f.available, projectedAvailable: f.projectedAvailable }, { available: 4445, projectedAvailable: 3645 });
}

/* ---------------- D. income ---------------- */

console.log("D. income");
{
  const items = [LINE, INCOME_LINE];
  const inc = (amount) => txn("Paid", amount, { is_income: true, budget_item_id: "LI", category: "Fundraising" });
  const f = figures([inc(500), txn("Paid", 100)], { items });
  assertEq("Paid income counts toward Money In and actual income", { moneyIn: f.moneyIn, actualIncome: f.actualIncome }, { moneyIn: 500, actualIncome: 500 });
  assertEq("...and never toward expense Paid, To Pay, Available or Committed",
    core(f), { paid: 100, toPay: 0, available: 900, committed: 100 });
}

/* ---------------- E. what the drawer tells the coach ---------------- */

console.log("E. transactionEffect");
assertEq("Paid expense", rules.transactionEffect(txn("Paid", 10)), "Paid. Counts toward Paid and against its budget line.");
assertEq("To Pay expense", rules.transactionEffect(txn("To Pay", 10)),
  "Not paid yet. Counts against its budget line and shows in To Pay until it's marked Paid.");
assertEq("expense with no amount", rules.transactionEffect(txn("To Pay", null)), "No amount recorded yet, so this doesn't affect the budget.");
assertEq("income", rules.transactionEffect(txn("Paid", 10, { is_income: true })), "Counts toward Money In.");
assertEq("income with no amount", rules.transactionEffect(txn("Paid", null, { is_income: true })),
  "No amount recorded yet, so this isn't counted in Money In.");
assertEq("an unrecognised status is called out, not described as committed",
  rules.transactionEffect(txn("Ordered", 10)), "This status isn't recognised, so it doesn't affect the budget.");

/* ---------------- F. saveTransaction against an in-memory database ---------------- */

function fakeDb(line) {
  const writes = [];
  function builder(table) {
    const q2 = { table, op: "select", filters: {}, payload: null };
    const result = () => {
      if (q2.op !== "select") return { data: null, error: null };
      if (table === "budget_items") return { data: line, error: null };
      return { data: [], error: null };
    };
    const b = {
      select() { return b; },
      eq(col, val) { q2.filters[col] = val; return b; },
      maybeSingle() { return Promise.resolve(result()); },
      single() { return Promise.resolve(result()); },
      update(payload) { q2.op = "update"; q2.payload = payload; writes.push(q2); return b; },
      insert(payload) { q2.op = "insert"; q2.payload = payload; writes.push(q2); return b; },
      delete() { q2.op = "delete"; writes.push(q2); return b; },
      then(res, rej) { return Promise.resolve(result()).then(res, rej); },
    };
    return b;
  }
  return { from: builder, writes };
}
function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, v);
  return fd;
}
const EXPENSE_LINE_ROW = { category: "Player Uniforms", is_income: false, season_id: "season-1" };
const INCOME_LINE_ROW = { category: "Fundraising", is_income: true, season_id: "season-1" };

(async () => {
  const { saveTransaction } = require(path.join(ROOT, "lib", "actions", "finance.js"));
  console.log("F. saveTransaction (in-memory database)");

  async function save(line, status, extra = {}) {
    db = fakeDb(line);
    const res = await saveTransaction(form({
      budget_item_id: "L1", item: "Uniform order", txn_date: "2026-11-06", actual_amount: "300", status, ...extra,
    }));
    const w = db.writes.filter((x) => x.table === "budget_transactions");
    return { res, written: w.map((x) => ({ op: x.op, status: x.payload?.status, amount: x.payload?.actual_amount })) };
  }

  assertEq("expense with no status sent is written as Paid",
    await save(EXPENSE_LINE_ROW, undefined), { res: { ok: true }, written: [{ op: "insert", status: "Paid", amount: 300 }] });
  assertEq("expense To Pay is written as To Pay",
    await save(EXPENSE_LINE_ROW, "To Pay"), { res: { ok: true }, written: [{ op: "insert", status: "To Pay", amount: 300 }] });
  assertEq("expense Paid is written as Paid",
    await save(EXPENSE_LINE_ROW, "Paid"), { res: { ok: true }, written: [{ op: "insert", status: "Paid", amount: 300 }] });
  assertEq("expense Planned is refused and nothing is written",
    await save(EXPENSE_LINE_ROW, "Planned"), { res: { ok: false, error: "Choose To Pay or Paid." }, written: [] });
  assertEq("editing an expense keeps its chosen status",
    await save(EXPENSE_LINE_ROW, "To Pay", { id: "t9" }), { res: { ok: true }, written: [{ op: "update", status: "To Pay", amount: 300 }] });
  assertEq("income with no status sent is written as Paid",
    await save(INCOME_LINE_ROW, undefined), { res: { ok: true }, written: [{ op: "insert", status: "Paid", amount: 300 }] });
  assertEq("income sent as To Pay is still written as Paid",
    await save(INCOME_LINE_ROW, "To Pay"), { res: { ok: true }, written: [{ op: "insert", status: "Paid", amount: 300 }] });

  /* ---------------- G. the form and list, rendered ---------------- */

  console.log("G. transaction form and list");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const consoleError = console.error;
  console.error = (msg, ...rest) => {
    if (typeof msg === "string" && msg.includes("Invalid value for prop") && rest.includes("`action`")) return;
    consoleError(msg, ...rest);
  };
  const { __TransactionForm: TransactionForm, __TransactionDetail: TransactionDetail, TransactionsTab } =
    require(path.join(ROOT, "components", "FinanceClient.js"));
  const noop = () => {};
  const lines = [{ ...LINE }, { ...INCOME_LINE }];
  const renderForm = (row) => renderToStaticMarkup(React.createElement(TransactionForm, {
    row, budgetItems: lines, tournaments: [], players: [], facilities: [], pending: false, onSubmit: noop, onCancel: noop,
  }));
  const statusSelect = (html) => {
    const m = html.match(/<select id="t-status"[^>]*>([\s\S]*?)<\/select>/);
    if (!m) return null;
    return [...m[1].matchAll(/<option value="([^"]*)"( selected="")?/g)].map((o) => (o[2] ? `${o[1]}*` : o[1]));
  };

  assertEq("new transaction: status offers To Pay and Paid, Paid selected",
    statusSelect(renderForm(null)), ["To Pay", "Paid*"]);
  assertEq("editing a To Pay expense: To Pay selected",
    statusSelect(renderForm({ id: "t1", status: "To Pay", actual_amount: 10, budget_item_id: "L1", is_income: false, item: "x", txn_date: "2026-11-06" })),
    ["To Pay*", "Paid"]);
  {
    const html = renderForm({ id: "t2", status: "Paid", actual_amount: 10, budget_item_id: "LI", is_income: true, item: "x", txn_date: "2026-11-06" });
    assertEq("editing income: no status selector at all", statusSelect(html), null);
    assertEq("...and the note says income is recorded when received", /Record income when you receive it/.test(html), true);
  }
  {
    const html = renderForm(null);
    assertEq("no retired status appears anywhere in the form", /Planned<|Ordered<|Received</.test(html), false);
  }
  {
    const rows = [
      { id: "a", item: "Bill", status: "To Pay", actual_amount: 40, is_income: false, txn_date: "2026-11-01", category: "Equipment" },
      { id: "b", item: "Car wash", status: "Paid", actual_amount: 500, is_income: true, txn_date: "2026-11-02", category: "Fundraising" },
    ];
    const html = renderToStaticMarkup(React.createElement(TransactionsTab, { transactions: rows, canWrite: true, onAdd: noop, onOpen: noop }));
    assertEq("list: an expense shows its status", /class="txn-status pill-deposit"[^>]*>To Pay</.test(html), true);
    assertEq("list: income shows no status", (html.match(/class="txn-status /g) ?? []).length, 1);
  }
  {
    const html = renderToStaticMarkup(React.createElement(TransactionDetail, {
      t: { id: "a", item: "Bill", status: "To Pay", actual_amount: 40, is_income: false, txn_date: "2026-11-01" }, canWrite: false, onClose: noop,
    }));
    assertEq("drawer: To Pay pill and the To Pay explanation",
      [/pill pill-deposit">To Pay</.test(html), /shows in To Pay until it&#x27;s marked Paid/.test(html)], [true, true]);
  }

  /* ---------------- H. the pending migration ---------------- */

  console.log("H. pending migration");
  const MIG = path.join(ROOT, "supabase", "pending", "fin_txn_status_to_pay_paid.sql");
  const sql = fs.readFileSync(MIG, "utf8").replace(/^\s*--.*$/gm, "");
  assertEq("Ordered and Received become To Pay; Planned only when it has no amount",
    /set status = 'To Pay'\s+where status in \('Ordered', 'Received'\)\s+or \(status = 'Planned' and actual_amount is null\);/.test(sql), true);
  assertEq("Paid is never updated", /set status = 'Paid'/.test(sql), false);
  assertEq("refuses to run if a Planned row carries an amount",
    /status = 'Planned' and actual_amount is not null;[\s\S]*?raise exception/.test(sql), true);
  assertEq("refuses to run if any income row is not Paid",
    /is_income and status <> 'Paid';[\s\S]*?raise exception/.test(sql), true);
  assertEq("new constraint allows exactly To Pay and Paid",
    /add constraint budget_transactions_status_check check \(status in \('To Pay', 'Paid'\)\)/.test(sql), true);
  assertEq("default becomes Paid", /alter column status set default 'Paid'/.test(sql), true);
  assertEq("compares a financial fingerprint before and after, and aborts on any difference",
    /if money_after <> money_before then\s+raise exception/.test(sql), true);
  assertEq("compares every non-status column before and after",
    /if rows_after <> rows_before then\s+raise exception/.test(sql), true);
  assertEq("touches no other table",
    [...sql.matchAll(/\b(?:update|alter table|insert into|delete from)\s+([a-z_.]+)/g)].map((m) => m[1]).every((t) => t === "public.budget_transactions"), true);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
