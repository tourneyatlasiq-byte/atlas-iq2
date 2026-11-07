/**
 * ST-011: one tournament commitment is never counted twice — BEHAVIOURAL.
 *
 * Ownership rule (2026-11):
 *   - recorded tournament transactions stay on the budget line they were filed on;
 *   - a committed tournament's total commitment is the larger of its cost and ALL
 *     its recorded (To Pay + Paid) expense transactions, on any line;
 *   - the tournament's own line — or the unassigned panel when it has none — owns
 *     only the remainder not already recorded elsewhere, never below zero;
 *   - a fully covered but uncategorized tournament is still listed (Needs
 *     Attention) at $0, so Projected Available is not reduced a second time.
 *
 * Every case runs the real Finance code (buildBudget, financeSummary,
 * unassignedTournamentCommitments, budgetLineFinance) and checks the figures
 * a coach sees plus the invariants that must hold everywhere.
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

const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => null };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};

const rules = require(path.join(ROOT, "lib", "finance-rules.js"));
const q = require(path.join(ROOT, "lib", "queries", "finance.js"));
const { sumMoney, cents } = rules;

const A = { id: "A", category: "Tournament Fees", name: "Entry fees", budgeted: 5000, is_income: false };
const B = { id: "B", category: "Equipment", name: "Gear", budgeted: 1000, is_income: false };
const C = { id: "C", category: "Other", name: "Misc", budgeted: 1000, is_income: false };
const INC = { id: "I", category: "Fundraising", name: "Car wash", budgeted: 500, is_income: true };
const ITEMS = [A, B, C, INC];
let n = 0;
const tx = (line, amount, status = "Paid", extra = {}) => ({
  id: `x${++n}`, budget_item_id: line, tournament_id: "T", actual_amount: amount, status,
  is_income: line === "I", category: "x", ...extra,
});
const T = (line, cost = 1000, decision = "Committed") => ({ id: "T", name: "Fall Classic", decision, total_cost: cost, budget_item_id: line });

/** Every figure, plus the invariants that must hold in every case. */
function figures(t, txs, label) {
  const tournaments = Array.isArray(t) ? t : [t];
  const budget = q.buildBudget(ITEMS, txs, tournaments);
  const s = q.financeSummary(budget, txs, []);
  const un = q.unassignedTournamentCommitments(tournaments, txs);
  const unTotal = sumMoney(un.map((u) => u.amount));
  const line = (id) => budget.expenses.flatMap((g) => g.rows).find((r) => r.id === id);
  const lines = [A, B, C].map((l) => line(l.id));
  // Invariants on every line and in the summary.
  const lineOk = lines.every((r) =>
    r.actual <= r.committedTotal + 1e-9 && r.toPay >= 0 &&
    cents(r.budgeted) === cents(r.actual) + cents(r.toPay) + cents(r.available));
  const summaryOk = s.toPay >= 0 && cents(s.budgetedExpenses) === cents(s.actualExpenses) + cents(s.toPay) + cents(s.availableBudget);
  if (!lineOk || !summaryOk) { failed++; console.log(`  FAIL  ${label}: Paid ≤ Committed, To Pay ≥ 0 and Budget = Paid + To Pay + Available must hold`); }
  else passed++;
  return {
    counted: sumMoney([s.committedExpenses, unTotal]),
    committed: s.committedExpenses, paid: s.actualExpenses, toPay: s.toPay,
    unassigned: unTotal, listed: un.length, projected: sumMoney([s.availableBudget, -unTotal]),
    A: line("A").committedTotal, B: line("B").committedTotal, C: line("C").committedTotal,
  };
}
/** The economic truth: loose transactions + max(cost, all recorded) per committed tournament. */
const economic = (cost, txs) => Math.max(cost, sumMoney(txs.filter((x) => !x.is_income && x.actual_amount != null && ["Paid", "To Pay"].includes(x.status)).map((x) => x.actual_amount)));

console.log("A. tournament with no budget category");
{
  let txs = [tx("B", 400)];
  let f = figures(T(null), txs, "unassigned, $400 < cost");
  assertEq("$400 Paid on B, cost $1,000: B $400, panel $600, counted once ($1,000)",
    [f.B, f.unassigned, f.counted, f.listed], [400, 600, economic(1000, txs), 1]);
  assertEq("...Projected Available = Available − $600, not − $1,000", f.projected, sumMoney([7000 - 400, -600]));

  txs = [tx("B", 1000)];
  f = figures(T(null), txs, "unassigned, = cost");
  assertEq("$1,000 Paid on B = cost: panel $0, counted once", [f.B, f.unassigned, f.counted], [1000, 0, 1000]);
  assertEq("...still listed under Needs Attention as needing a category", f.listed, 1);
  assertEq("...and Projected Available is not reduced again", f.projected, sumMoney([7000 - 1000]));

  txs = [tx("B", 1200)];
  f = figures(T(null), txs, "unassigned, > cost");
  assertEq("$1,200 Paid on B > cost: panel $0, counted $1,200 (larger of cost and recorded)", [f.B, f.unassigned, f.counted, f.listed], [1200, 0, 1200, 1]);

  txs = [tx("B", 300, "Paid"), tx("B", 300, "To Pay")];
  f = figures(T(null), txs, "unassigned, Paid + To Pay");
  assertEq("$300 Paid + $300 To Pay on B: both count as recorded; panel $400", [f.B, f.paid, f.toPay, f.unassigned, f.counted], [600, 300, 300, 400, 1000]);

  txs = [tx("B", 300), tx("C", 200, "To Pay"), tx("C", 100)];
  f = figures(T(null), txs, "unassigned, several lines");
  assertEq("transactions on B and C: each stays on its line; panel holds the $400 rest", [f.B, f.C, f.unassigned, f.counted], [300, 300, 400, 1000]);

  txs = [tx("B", 400), tx("B", 50, "To Pay", { actual_amount: null })];
  f = figures(T(null), txs, "unassigned, null amount");
  assertEq("a transaction with no amount records nothing", [f.B, f.unassigned], [400, 600]);
}

console.log("B. tournament assigned to a budget line");
{
  let txs = [tx("B", 400)];
  let f = figures(T("A"), txs, "on A, txn on B");
  assertEq("T on A, $400 Paid on B: A holds $600, B $400, counted once", [f.A, f.B, f.counted, f.listed], [600, 400, 1000, 0]);

  txs = [tx("A", 300), tx("B", 400, "To Pay")];
  f = figures(T("A"), txs, "on A, split A/B");
  assertEq("$300 Paid on A + $400 To Pay on B: A $600 (its own $300 inside), B $400", [f.A, f.B, f.paid, f.toPay, f.counted], [600, 400, 300, 700, 1000]);

  txs = [tx("B", 1200)];
  f = figures(T("A"), txs, "on A, B exceeds cost");
  assertEq("$1,200 Paid on B > cost: A $0, B $1,200, counted $1,200", [f.A, f.B, f.counted], [0, 1200, 1200]);

  txs = [tx("A", 700), tx("B", 600)];
  f = figures(T("A"), txs, "on A, A+B exceed cost");
  assertEq("$700 on A + $600 on B > cost: total $1,300 = A $700 + B $600", [f.A, f.B, f.counted], [700, 600, 1300]);
}

console.log("C. normal same-line behaviour is unchanged");
{
  let f = figures(T("A"), [], "on A, nothing recorded");
  assertEq("T on A, nothing recorded: A $1,000 committed, all To Pay", [f.A, f.toPay, f.counted], [1000, 1000, 1000]);
  f = figures(T("A"), [tx("A", 400)], "on A, $400 on A");
  assertEq("$400 Paid on A: A $1,000, Paid $400, To Pay $600", [f.A, f.paid, f.toPay], [1000, 400, 600]);
  f = figures(T("A"), [tx("A", 1200)], "on A, $1,200 on A");
  assertEq("$1,200 Paid on A: A $1,200 (larger of cost and recorded), To Pay $0", [f.A, f.paid, f.toPay], [1200, 1200, 0]);
  f = figures(T("A"), [tx("A", 495), tx("A", 60, "To Pay")], "on A, mixed");
  assertEq("$495 Paid + $60 To Pay on A: still $1,000 (never the sum with cost)", [f.A, f.paid, f.toPay], [1000, 495, 505]);
  f = figures(T(null), [], "unassigned, nothing recorded");
  assertEq("no category, nothing recorded: panel $1,000 (unchanged)", [f.unassigned, f.listed], [1000, 1]);
}

console.log("D. assigning the tournament later");
{
  const txs = [tx("B", 400)];
  const before = figures(T(null), txs, "before assignment");
  const after = figures(T("A"), txs, "after assignment");
  assertEq("before: B $400 + panel $600; after: B $400 + A $600 — the same $1,000 either way",
    [before.B, before.unassigned, after.B, after.A, after.unassigned, before.counted, after.counted], [400, 600, 400, 600, 0, 1000, 1000]);
  assertEq("...and Projected Available is the same before and after", before.projected, after.projected);
}

console.log("E. what never counts");
{
  let f = figures(T(null, 1000, "Considering"), [tx("B", 400)], "considering");
  assertEq("a Considering tournament commits nothing; its transaction is an ordinary $400 on B", [f.B, f.unassigned, f.listed, f.counted], [400, 0, 0, 400]);
  f = figures(T("A", 1000, "Declined"), [tx("A", 400)], "declined");
  assertEq("a Declined tournament commits nothing; the $400 on A stays", [f.A, f.counted], [400, 400]);
  f = figures(T(null), [tx("I", 800, "Paid")], "income");
  assertEq("an income transaction linked to the tournament reduces nothing", [f.unassigned, f.committed], [1000, 0]);
  f = figures(T(null, null), [tx("B", 400)], "no cost");
  assertEq("an unpriced committed tournament is not listed; its transaction counts on B", [f.listed, f.B], [0, 400]);
}

console.log("F. building blocks");
{
  const txs = [tx("A", 300), tx("B", 400, "To Pay"), tx("C", 100, "Paid", { actual_amount: null }), tx("I", 50)];
  assertEq("tournamentRecorded: To Pay + Paid expense on any line", rules.tournamentRecorded("T", txs), 700);
  assertEq("tournamentRecorded excluding the owner line", rules.tournamentRecorded("T", txs, { excludeLineId: "A" }), 400);
  assertEq("tournamentRemainder on A = max(1000, 700) − 400", rules.tournamentRemainder(T("A"), txs, "A"), 600);
  assertEq("tournamentRemainder never below zero", rules.tournamentRemainder(T(null, 100), [tx("B", 900)], null), 0);
  const u = q.unassignedTournamentCommitments([T(null)], [tx("B", 1000)])[0];
  assertEq("a fully covered unassigned tournament reports $0 outstanding and what's recorded", [u.amount, u.totalCost, u.recordedElsewhere], [0, 1000, 1000]);
}

console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
