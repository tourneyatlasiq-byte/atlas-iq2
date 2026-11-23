/**
 * Budget edge cases (2026-11-22 review of the optional budgeting package).
 * BEHAVIOURAL: runs the real app functions.
 *
 * Core property: when an expense budget exists, season Committed
 * (financeSummary.committedExpenses) must equal an independently computed
 * total of every obligation, so no amount disappears and none counts twice:
 *   - Committed tournament: the larger of its cost and ALL its recorded
 *     (To Pay + Paid) expense transactions, on any line or none;
 *   - every other recorded expense transaction (Considering or Declined
 *     tournament, or no tournament): its own amount.
 * And always: Paid + To Pay + Available = Allocated.
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
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
const readiness = require(path.join(ROOT, "lib", "readiness", "tournaments.js"));
const { deriveSummary } = require(path.join(ROOT, "lib", "queries", "tournaments.js"));

let n = 0;
const line = (id, category, budgeted) => ({ id, category, name: id, budgeted, is_income: false });
const tourn = (id, total_cost, extra = {}) => ({ id, name: id, decision: "Committed", total_cost, budget_item_id: null, paid_status: "Registered", start_date: "2027-03-01", ...extra });
const tx = (tournament_id, amount, line_id, status = "Paid") => ({ id: `x${++n}`, tournament_id, actual_amount: amount, status, is_income: false, budget_item_id: line_id });

const obligations = (tournaments, txs) => {
  const byId = new Map(tournaments.map((t) => [t.id, t]));
  const cents = (v) => Math.round(Number(v) * 100);
  const recorded = (id) => txs.filter((x) => x.tournament_id === id && !x.is_income && (x.status === "Paid" || x.status === "To Pay")).reduce((s, x) => s + cents(x.actual_amount ?? 0), 0);
  let total = 0;
  for (const t of tournaments) if (t.decision === "Committed") total += Math.max(cents(t.total_cost ?? 0), recorded(t.id));
  for (const x of txs) {
    if (x.is_income || !(x.status === "Paid" || x.status === "To Pay")) continue;
    const t = x.tournament_id ? byId.get(x.tournament_id) : null;
    if (!t || t.decision !== "Committed") total += cents(x.actual_amount ?? 0);
  }
  return total / 100;
};
const run = (items, tournaments, txs) => {
  const budget = q.buildBudget(items, txs, tournaments);
  const s = q.financeSummary(budget, txs, []);
  return { budget, s, identity: rules.sumMoney([s.actualExpenses, s.toPay, s.availableBudget]) === s.budgetedExpenses };
};
const items = [line("tf", "Tournament Fees", 5000), line("eq", "Equipment", 1000)];

console.log("1. Committed, unlinked, blank or $0 cost, with recorded money");
for (const [label, cost, txs] of [
  ["blank cost, $500 Paid on no budget line", null, [tx("t", 500, null)]],
  ["$0 cost, $500 Paid on no budget line", 0, [tx("t", 500, null)]],
  ["blank cost, $300 To Pay on no budget line", null, [tx("t", 300, null, "To Pay")]],
  ["blank cost, $500 Paid on the Equipment line", null, [tx("t", 500, "eq")]],
]) {
  const ts = [tourn("t", cost)];
  const r = run(items, ts, txs);
  assertEq(`${label}: season Committed equals total obligations`, r.s.committedExpenses, obligations(ts, txs));
  assertEq(`${label}: Tournaments dashboard Committed cost agrees with Finance`, deriveSummary(ts, new Date("2026-11-22T12:00:00"), txs).committedCost, obligations(ts, txs));
  assertEq(`${label}: Paid + To Pay + Available = Allocated`, r.identity, true);
}

console.log("2. Unbudgeted expenses, Considering payments, other lines, overpayments");
{
  const ts = [tourn("c", 1000, { budget_item_id: "tf" }), tourn("k", 800, { decision: "Considering" })];
  const txs = [tx("k", 200, "tf"), tx("c", 400, "eq"), tx("c", 300, "tf", "To Pay")];
  const r = run(items, ts, txs);
  assertEq("payment on a Considering tournament (on a line) counts once", r.s.committedExpenses, obligations(ts, txs));
  assertEq("committed tournament paid on a different line is not double counted: 1000 total, 400 on Equipment", r.budget.expenses.find((g) => g.category === "Equipment").committedTotal, 400);
  assertEq("... and the Tournament Fees line holds the rest (1000 - 400 + 200 Considering payment)", r.budget.expenses.find((g) => g.category === "Tournament Fees").committedTotal, 800);
  assertEq("identity holds", r.identity, true);
}
{
  const ts = [tourn("o", 600, { budget_item_id: "tf" })];
  const txs = [tx("o", 900, "tf")];
  const r = run(items, ts, txs);
  assertEq("payment above the estimated cost: commitment is the payment, not cost + payment", r.s.committedExpenses, 900);
  assertEq("... Available falls by 900, To Pay is 0, never negative", [r.s.availableBudget, r.s.toPay], [5100, 0]);
}
{
  const ts = [tourn("u", 400, { budget_item_id: "tf" })];
  const txs = [tx("k2", 150, null)];
  const r = run(items, ts, txs);
  assertEq("unbudgeted (no line, no tournament) paid expense: identity still holds", r.identity, true);
  assertEq("... and To Pay is never negative", r.s.toPay >= 0, true);
  // PRE-EXISTING, not changed here: an expense with no budget line and no
  // tournament counts as Paid but is never inside Committed, so it neither
  // reduces Available nor leaves To Pay whole (400 owed shows as 250).
  // Production has no such transaction today; reported for a decision.
  assertEq("documented: unbudgeted paid expense is outside Committed (pre-existing)", [r.s.committedExpenses, r.s.toPay], [400, 250]);
}

console.log("3. Category rule: an explicitly named tournament category wins; links are never moved");
{
  const its = [line("tf", "Tournament Fees", 5000), line("fld", "Field / Facility Costs", 2000)];
  assertEq("a tournament linked to another category does not pull unassigned costs there",
    rules.tournamentCategoryFor(its, [tourn("a", 100, { budget_item_id: "fld" }), tourn("b", 100, { budget_item_id: "fld" })]), "Tournament Fees");
  assertEq("no named category: season level, even when tournaments are linked to some other category",
    rules.tournamentCategoryFor([line("fld", "Field / Facility Costs", 2000)], [tourn("a", 100, { budget_item_id: "fld" })]), null);
  assertEq("'Tournaments' is also recognised, case and spacing ignored; the stored name is returned so groups match", rules.tournamentCategoryFor([line("x", " tournaments ", 10)], []), " tournaments ");
  assertEq("Tournament Fees is preferred when both names exist", rules.tournamentCategoryFor([line("a", "Tournaments", 1), line("b", "Tournament Fees", 1)], []), "Tournament Fees");
  const ts = [tourn("a", 100, { budget_item_id: "fld" }), tourn("u", 700)];
  const r = run(its, ts, []);
  assertEq("the linked tournament stays on its own line", r.budget.expenses.find((g) => g.category === "Field / Facility Costs").committedTotal, 100);
  assertEq("the unassigned one lands in the named category", r.budget.expenses.find((g) => g.category === "Tournament Fees").unassignedAmount, 700);
}

console.log("4. Cost not entered: a partial payment does not resolve a missing cost");
{
  const ts = [tourn("p", null), tourn("z", 0), tourn("n", null)];
  const txs = [tx("p", 200, null)];
  const s = rules.tournamentCostSummary(ts, txs);
  assertEq("Committed, blank cost, $200 paid is still flagged; $0 free is not; nothing recorded is flagged", s.missingCost.map((t) => t.id).sort(), ["n", "p"]);
  const act = readiness.tournamentActions(ts, new Date("2026-11-22T12:00:00"), txs).find((a) => a.id === "cost");
  assertEq("the Needs action item lists both", act && act.affected.map((t) => t.id).sort(), ["n", "p"]);
  assertEq("typing the real cost clears it", rules.tournamentCostSummary([tourn("p", 650)], txs).missingCost.length, 0);
  assertEq("commitment for the partly paid tournament is unchanged (the payment), no invented figure", rules.tournamentCommitment(ts[0], txs), 200);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
