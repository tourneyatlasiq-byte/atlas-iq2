/**
 * Money In income goals + named payment Remove (2026-11).
 *
 *   A. incomeProgress: the one rule for Goal / Received / Remaining / Over goal
 *   B. Money In rendered: income table, labels, Over goal, Edit/Delete by role
 *   C. Expense Budget tab rendered: labels and figures unchanged
 *   D. Delete wording and protections reused for income goals
 *   E. Payment Remove names the entry
 *   F. Source: no new server action, existing protections still in place
 *
 * Same harness as check-dues-filter.js: SWC from Next.js, stubbed framework
 * and database modules, no network.
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

const STUB_DIR = path.join(ROOT, "scripts", "__income_goal_stubs__");
const stubs = new Map();
const stub = (name, exportsObj) => stubs.set(name, exportsObj);
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
  if (resolved === SUPABASE_SERVER) return { createClient: () => null };
  if (resolved === CONTEXT) return { requireSeasonContext: async () => ({}), canWrite: () => true };
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
    src += "\nexport { PaymentDetail as __PaymentDetail };\n";
  }
  const { code } = swc.transformSync(src, { ...SWC_OPTS, filename });
  module._compile(code, filename);
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { incomeProgress } = require(path.join(ROOT, "lib", "finance-rules.js"));
const { buildBudget, fundsIn } = require(path.join(ROOT, "lib", "queries", "finance.js"));
const FC = require(path.join(ROOT, "components", "FinanceClient.js"));
const noop = () => {};
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&rsquo;/g, "’").replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/\s+/g, " ");

/* ---------------- A ---------------- */
console.log("A. incomeProgress");
assertEq("received under goal: remaining, no over", (({ remaining, over, state }) => ({ remaining, over, state }))(incomeProgress(10, 4)), { remaining: 6, over: 0, state: "to-go" });
assertEq("received equals goal: met", incomeProgress(10, 10).state, "met");
assertEq("received above goal: over by the difference", (({ remaining, over, state }) => ({ remaining, over, state }))(incomeProgress(10, 12.5)), { remaining: 0, over: 2.5, state: "over" });
assertEq("cents are exact: 0.10 + 0.20 against 0.30 is met, not over or short", incomeProgress(0.3, 0.1 + 0.2).state, "met");
assertEq("no goal never claims Over goal", incomeProgress(0, 500).state, "no-goal");
assertEq("null goal and null received are safe", incomeProgress(null, null).state, "no-goal");

/* ---------------- fixture ---------------- */
const items = [
  { id: "L-spon", organization_id: "o", category: "Sponsors", name: "Local sponsors", budgeted: 500, is_income: true },
  { id: "L-fund", organization_id: "o", category: "Fundraising", name: "Car wash", budgeted: 300, is_income: true },
  { id: "L-fee", organization_id: "o", category: "Tournament Fees", name: "Entry fees", budgeted: 1000, is_income: false },
];
const txns = [
  { id: "t1", budget_item_id: "L-spon", is_income: true, status: "Paid", actual_amount: 650, category: "Sponsors", budget_item: { category: "Sponsors" }, item: "Dugout banner", txn_date: "2026-10-01" },
  { id: "t2", budget_item_id: "L-fund", is_income: true, status: "Paid", actual_amount: 100, category: "Fundraising", budget_item: { category: "Fundraising" }, item: "Car wash", txn_date: "2026-10-02" },
  { id: "t3", budget_item_id: "L-fee", is_income: false, status: "Paid", actual_amount: 400, category: "Tournament Fees", budget_item: { category: "Tournament Fees" }, item: "Entry", txn_date: "2026-10-03" },
];
const budget = buildBudget(items, txns, []);
const funds = fundsIn(txns, [], items);
const dues = { expected: 0 };

const money = (props = {}) => renderToStaticMarkup(React.createElement(FC.FundsInTab, {
  funds, dues, budget, canWrite: true, pending: false, openCats: { "income:Sponsors": true, "income:Fundraising": true },
  setOpenCats: noop, onEdit: noop, onDelete: noop, onCancelDelete: noop, onConfirmDelete: noop,
  transactions: txns, tournaments: [], onReviewTransaction: noop, ...props,
}));

/* ---------------- B ---------------- */
console.log("B. Money In rendered");
{
  const html = money();
  const t = text(html);
  assertEq("an Income goals section is shown", /Income goals/.test(t), true);
  assertEq("columns read Goal, Received, Remaining, Status", /Goal\s+Received\s+Remaining\s+Status/.test(t), true);
  assertEq("expense wording is not used in the income table", /To pay|Available/.test(t), false);
  assertEq("Sponsors (received 650 of 500) says Over goal by $150.00", /Over goal by \$150\.00/.test(t), true);
  assertEq("Fundraising (100 of 300) is In progress with $200.00 remaining", /In progress/.test(t) && /\$200\.00/.test(t), true);
  assertEq("the Sponsorships card says Over goal by $150.00", /Over goal by \$150\.00/.test(t.split("Income goals")[0]), true);
  assertEq("over goal is styled as success, never the expense red", /income-over/.test(html) && !/class="[^"]*(?<![-\w])over[ "]/.test(html.split("Income goals")[1] ?? ""), true);
  assertEq("Edit and Delete are offered per income line", (html.match(/>Edit</g) || []).length === 2 && (html.match(/>Delete</g) || []).length === 2, true);
  const ro = money({ canWrite: false });
  assertEq("read-only role: no Edit or Delete", />Edit<|>Delete</.test(ro), false);
  const none = money({ budget: { ...budget, income: [] } });
  assertEq("no income goals: no Income goals section", /Income goals/.test(text(none)), false);
  const met = text(money({ funds: { ...funds, fundraising: 300 } }));
  assertEq("received exactly equal to goal still reads Target met on the card", /Target met/.test(met), true);
}

/* ---------------- C ---------------- */
console.log("C. Expense Budget tab unchanged");
{
  const html = renderToStaticMarkup(React.createElement(FC.BudgetTab, {
    budget, summary: {}, committedTournaments: 0, tournamentPaid: 0, openCats: { "Tournament Fees": true }, setOpenCats: noop,
    canWrite: true, onAdd: noop, onEdit: noop, onDelete: noop, pending: false, transactions: txns, tournaments: [],
  }));
  const t = text(html);
  assertEq("expense columns are Budget, Paid, To pay, Available", /Budget\s+Paid\s+To pay\s+Available/.test(t), true);
  assertEq("no income wording leaks into expenses", /Goal|Received|Remaining|Over goal/.test(t), false);
  assertEq("expense line figures: $1,000.00 budget, $400.00 paid", /\$1,000\.00/.test(t) && /\$400\.00/.test(t), true);
  assertEq("expense table does not list the income lines", /Local sponsors/.test(t), false);
}

/* ---------------- D ---------------- */
console.log("D. delete wording and protections for income goals");
{
  const clean = text(money({ confirmingDelete: "budget:L-fund", transactions: [] }));
  assertEq("a clean income goal gets the plain confirmation, named as an income goal", /Delete income goal/.test(clean) && /Delete the income goal "Car wash"/.test(clean), true);
  assertEq("...with Keep income goal", /Keep income goal/.test(clean), true);
  const blocked = text(money({ confirmingDelete: "budget:L-spon" }));
  assertEq("a goal with a transaction is blocked, with no Delete button", /Can’t delete this income goal yet/.test(blocked) && !/Delete income goal/.test(blocked), true);
  assertEq("...and names the transaction in the way", /Dugout banner|\$650\.00/.test(blocked), true);
  const tourn = text(money({ confirmingDelete: "budget:L-fund", transactions: [], tournaments: [{ id: "T1", name: "Spring Bash", budget_item_id: "L-fund", total_cost: 100 }] }));
  assertEq("a goal a tournament points at is blocked and names the tournament", /Spring Bash/.test(tourn) && /Can’t delete this income goal yet/.test(tourn), true);
  const expenseDialog = text(renderToStaticMarkup(React.createElement(FC.BudgetTab, {
    budget, summary: {}, committedTournaments: 0, tournamentPaid: 0, openCats: {}, setOpenCats: noop, canWrite: true,
    onAdd: noop, onEdit: noop, onDelete: noop, pending: false, transactions: [], tournaments: [], confirmingDelete: "budget:L-fee",
    onCancelDelete: noop, onConfirmDelete: noop,
  })));
  assertEq("an expense line still says Delete budget line", /Delete budget line/.test(expenseDialog) && /Keep budget line/.test(expenseDialog), true);
}

/* ---------------- E ---------------- */
console.log("E. payment Remove names the entry");
{
  const p = { id: "P", player: { full_name: "Brynn Mower" }, status: "Partial", balance: 3800, totalDue: 4000, totalPaid: 200,
    log: [{ id: "e1", amount: 200, paid_date: "2026-08-09", month_label: "Aug 2026" }, { id: "e2", amount: 50.5, paid_date: "2026-09-01", month_label: null }] };
  assertEq("message names amount, date and player", FC.removeEntryMessage(p, "e1").startsWith("Remove the $200.00 payment from 08/09/2026 for Brynn Mower?"), true);
  assertEq("a different entry gets its own amount and date", /\$50\.50 payment from 09\/01\/2026/.test(FC.removeEntryMessage(p, "e2")), true);
  assertEq("the consequence sentence is kept", /total due is unchanged/.test(FC.removeEntryMessage(p, "e1")), true);
  assertEq("an unknown entry falls back to the generic question, not a guess", FC.removeEntryMessage(p, "nope").startsWith("Remove this payment entry?"), true);
  const noDate = { ...p, log: [{ id: "e3", amount: 10, paid_date: null, month_label: "October" }] };
  assertEq("no date: the month label is used", /\$10\.00 payment from October/.test(FC.removeEntryMessage(noDate, "e3")), true);
  const html = text(renderToStaticMarkup(React.createElement(FC.__PaymentDetail, {
    p, canWrite: true, pending: false, onClose: noop, onRecord: noop, onRecordOpen: noop, onDeleteEntry: noop,
    confirmingEntry: "entry:e1", onCancelEntry: noop, onConfirmEntry: noop, drawerError: null, onEdit: noop,
  })));
  assertEq("the drawer shows the named confirmation", /Remove the \$200\.00 payment from 08\/09\/2026 for Brynn Mower\?/.test(html), true);
  assertEq("...with the same Remove entry / Keep entry choices", /Remove entry/.test(html) && /Keep entry/.test(html), true);
}

/* ---------------- F ---------------- */
console.log("F. source: existing actions only");
{
  const client = read("components/FinanceClient.js");
  const income = client.slice(client.indexOf("export function FundsInTab"), client.indexOf("/* ---------------- Budget ---------------- */"));
  assertEq("Money In imports no new action: it calls the handlers it is given", /saveBudgetItem|deleteBudgetItem|deletePaymentEntry/.test(income), false);
  assertEq("delete still goes through deleteBudgetItem in FinanceClient", /run\(deleteBudgetItem, fd/.test(client), true);
  assertEq("edit still goes through the existing BudgetForm and saveBudgetItem", /run\(saveBudgetItem, fd/.test(client) && /<BudgetForm/.test(client), true);
  const actions = read("lib/actions/finance.js");
  assertEq("server still refuses a line with tournaments", /tournamentBlockers: linkedTournaments/.test(actions), true);
  assertEq("server still refuses a line with transactions unless move_to is given", /needsReassign: true/.test(actions), true);
  assertEq("server action count is unchanged (no new export added for income goals)", (actions.match(/export async function/g) || []).length, 13);
  assertEq("the budget-line requirement on transactions is untouched", /Pick a budget line|budget line/i.test(read("components/GuidedTransaction.js")), true);
}

console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
