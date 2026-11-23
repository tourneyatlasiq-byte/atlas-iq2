/**
 * Optional budgeting (2026-11-22): tournament costs work with or without a
 * budget, and when a budget exists every Committed tournament reduces
 * Available exactly once. BEHAVIOURAL: runs the real app functions.
 *
 * Fixtures reproduce the production reconciliation figures (Armor Elite Mower,
 * Northgate 16U Gold, 28/29 Lynch, Primary Team) so the before and after
 * numbers Autumn approved are asserted, not described.
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
const cost = require(path.join(ROOT, "lib", "tournament-cost.js"));
const readiness = require(path.join(ROOT, "lib", "readiness", "tournaments.js"));
const { deriveSummary } = require(path.join(ROOT, "lib", "queries", "tournaments.js"));

let n = 0;
const line = (id, category, budgeted, extra = {}) => ({ id, category, name: id, budgeted, is_income: false, ...extra });
const tourn = (id, total_cost, extra = {}) => ({ id, name: id, decision: "Committed", total_cost, budget_item_id: null, paid_status: "Registered", start_date: "2027-03-01", ...extra });
const pay = (tournament_id, amount, line_id, status = "Paid") => ({
  id: `x${++n}`, tournament_id, actual_amount: amount, status, is_income: false, budget_item_id: line_id,
});
const figures = (items, tournaments, txs) => {
  const budget = q.buildBudget(items, txs, tournaments);
  return { budget, s: q.financeSummary(budget, txs, []) };
};

/* ------------------------------------------------------------------ */
console.log("A. shared tournament cost summary (works with no budget at all)");
{
  const ts = [
    tourn("c1", 1000),
    tourn("c2", 555, { paid_status: "Waitlisted" }),
    tourn("c3", null),
    tourn("free", 0),
    tourn("c4", null),
    tourn("p1", 800, { decision: "Considering" }),
    tourn("p2", null, { decision: "Considering" }),
    tourn("d1", 400, { decision: "Declined" }),
  ];
  const txs = [pay("c4", 500, null), pay("c1", 600, null), pay("d1", 75, null)];
  const s = rules.tournamentCostSummary(ts, txs);
  assertEq("Committed cost is larger-of per tournament, Waitlisted included: 1000 + 555 + 0 + 0 + 500",
    [s.committedCost, s.committedCount], [2055, 5]);
  assertEq("Potential cost is Considering only, a blank cost adds nothing", [s.potentialCost, s.potentialCount], [800, 2]);
  assertEq("Payments recorded counts Paid money on every tournament, whatever its decision (600 + 500 + 75)", s.paymentsRecorded, 1175);
  assertEq("a Committed tournament with no cost entered is missing a cost even when something has been paid; a typed $0 is not",
    s.missingCost.map((t) => t.id), ["c3", "c4"]);
  assertEq("a free tournament is counted as free, not missing", s.freeCount, 1);
  assertEq("an empty season is all zeros", rules.tournamentCostSummary([], []).committedCost, 0);
  assertEq("dashboard deriveSummary uses the same larger-of figure when given transactions",
    deriveSummary(ts, new Date("2027-01-01T12:00:00"), txs).committedCost, 2055);
  assertEq("deriveSummary without transactions keeps the estimate-only behaviour (no regression)",
    deriveSummary(ts, new Date("2027-01-01T12:00:00")).committedCost, 1555);
}

/* ------------------------------------------------------------------ */
console.log("B. no budget: nothing is required, nothing is claimed");
{
  const ts = [tourn("t1", 1200), tourn("t2", 800)];
  const { budget, s } = figures([], ts, []);
  assertEq("no budget lines: no unassigned list, no season row, Available stays 0",
    [budget.unassignedTotal, budget.seasonUnassigned, s.availableBudget, s.committedExpenses, s.budgetedExpenses], [0, 0, 0, 0, 0]);
  assertEq("only income lines is still no budget", figures([{ id: "I", category: "Fundraising", budgeted: 500, is_income: true }], ts, []).s.availableBudget, 0);
  assertEq("tournament costs still computed from tournaments alone", rules.tournamentCostSummary(ts, []).committedCost, 2000);
}

/* ------------------------------------------------------------------ */
console.log("C. Armor Elite Mower: two Tournament Fees lines, linked and unlinked tournaments");
{
  const A1 = line("A1", "Tournament Fees", 13000);
  const A2 = line("A2", "Tournament Fees", 10000);
  const EQ = line("EQ", "Equipment", 25535.73); // everything else, so season allocation is 48,535.73
  const items = [A1, A2, EQ];
  const linked = [tourn("pack", 1250, { budget_item_id: "A1" }), tourn("tc", 1600, { budget_item_id: "A1" }), tourn("l3", 2950, { budget_item_id: "A2" })];
  const free = [tourn("u1", 2000), tourn("u2", 1770)]; // 3,770 unlinked
  const ts = [...linked, ...free, tourn("nocost1", null), tourn("nocost2", null)];
  const txs = [pay("pack", 1250, "A1"), pay("tc", 1600, "A1")];
  const { budget, s } = figures(items, ts, txs);
  assertEq("linked tournaments commit 5,800 on their lines (unchanged line math)",
    budget.expenses.flatMap((g) => g.rows).filter((r) => r.category === "Tournament Fees").map((r) => r.committedTotal), [2850, 2950]);
  assertEq("the 3,770 unlinked is attached to the existing Tournament Fees category, not a line",
    [budget.unassignedTotal, budget.unassignedCategory, budget.seasonUnassigned], [3770, "Tournament Fees", 0]);
  const cat = budget.expenses.find((g) => g.category === "Tournament Fees");
  assertEq("category: allocated 23,000, committed 5,800 + 3,770 = 9,570, available 13,430",
    [cat.budgeted, cat.committedTotal, cat.unassignedAmount, cat.available], [23000, 9570, 3770, 13430]);
  assertEq("individual line numbers do not change when unlinked tournaments exist",
    budget.expenses.flatMap((g) => g.rows).filter((r) => r.category === "Tournament Fees").map((r) => [r.committedTotal, r.available]),
    [[2850, 10150], [2950, 7050]]);
  assertEq("season Available = 48,535.73 allocated - 5,800 linked - 3,770 unlinked (was 42,735.73 before)", s.availableBudget, rules.sumMoney([48535.73, -5800, -3770]));
  assertEq("Budget = Paid + To Pay + Available still holds", cents(s.budgetedExpenses), cents(s.actualExpenses) + cents(s.toPay) + cents(s.availableBudget));
  function cents(v) { return rules.cents(v); }
}

/* ------------------------------------------------------------------ */
console.log("D. Northgate: three Tournament Fees lines, a null-cost tournament with $500 paid, cost below payment");
{
  const items = [line("N1", "Tournament Fees", 8000), line("N2", "Tournament Fees", 7000), line("N3", "Tournament Fees", 7000), line("OTH", "Equipment", 7680)];
  const ts = [
    tourn("alliance", null, { budget_item_id: "N1" }),
    tourn("fall", 555, { budget_item_id: "N1" }),
    tourn("peach", 650, { budget_item_id: "N2" }),
    tourn("k1", 3395, { budget_item_id: "N3" }),
    tourn("u1", 1000), tourn("u2", 315),
  ];
  const txs = [pay("alliance", 500, "N1"), pay("fall", 495, "N1"), pay("peach", 575, "N2")];
  const { budget, s } = figures(items, ts, txs);
  const cat = budget.expenses.find((g) => g.category === "Tournament Fees");
  assertEq("linked commitments 500 + 555 + 650 + 3,395 = 5,100 plus unlinked 1,315", [cat.committedTotal - cat.unassignedAmount, cat.unassignedAmount, cat.committedTotal], [5100, 1315, 6415]);
  assertEq("Alliance counts its $500 payment although no cost was entered; cost beats a smaller payment (Fall 555, Peach 650)",
    rules.tournamentCostSummary(ts, txs).committedCost, 500 + 555 + 650 + 3395 + 1315);
  assertEq("season Available = 29,680 - 6,415", s.availableBudget, 29680 - 6415);
}

/* ------------------------------------------------------------------ */
console.log("E. Lynch: no Tournament Fees line, $2,190 already paid on Team Fees & Administration");
{
  const items = [line("TF", "Team Fees & Administration", 44000)];
  // Show Me The Money (2,190) is unlinked, its payment sits on the Team Fees line.
  const others = Array.from({ length: 10 }, (_, i) => tourn(`o${i}`, 1900));
  others.push(tourn("o10", 2555));
  const ts = [tourn("smtm", 2190), ...others]; // others total 21,555
  const txs = [pay("smtm", 2190, "TF")];
  const before = rules.sumMoney([44000, -2190]);
  const { budget, s } = figures(items, ts, txs);
  assertEq("no tournament category exists, so the unlinked amount is a season level row of 21,555",
    [budget.unassignedCategory, budget.seasonUnassigned, budget.unassignedTotal], [null, 21555, 21555]);
  assertEq("the $2,190 already on Team Fees & Administration is NOT counted again", budget.unassigned.find((u) => u.id === "smtm").amount, 0);
  assertEq("Available 41,810 becomes 20,255, and committed is 2,190 + 21,555 = 23,745 (the tournaments' real total)",
    [before, s.availableBudget, s.committedExpenses], [41810, 20255, 23745]);
  assertEq("category rows are not altered by the season level row", budget.expenses[0].committedTotal, 2190);
}

/* ------------------------------------------------------------------ */
console.log("F. Primary Team: category named Tournaments with no linked tournament");
{
  const items = [line("P1", "Tournaments", 16800), line("P2", "Equipment", 15848)];
  const ts = [tourn("a", 9255)];
  const { budget, s } = figures(items, ts, []);
  assertEq("falls back to the category named Tournaments", [budget.unassignedCategory, budget.seasonUnassigned], ["Tournaments", 0]);
  assertEq("Available 32,648 becomes 23,393", s.availableBudget, 23393);
  assertEq("category available 16,800 becomes 7,545", budget.expenses.find((g) => g.category === "Tournaments").available, 7545);
}

/* ------------------------------------------------------------------ */
console.log("G. category choice rules");
{
  const t = (cat, linkCategory) => {
    const items = [line("L1", cat, 1000), line("L2", linkCategory, 1000)];
    const ts = [tourn("lk", 100, { budget_item_id: "L2" }), tourn("un", 50)];
    return q.buildBudget(items, [], ts).unassignedCategory;
  };
  // Review 2026-11-22: an unnamed category is never inferred from links.
  assertEq("a tournament linked to an unrelated category does not make it the home of unassigned costs", t("Equipment", "Travel Ball Events"), null);
  assertEq("an explicitly named category wins even when links point elsewhere", t("Tournament Fees", "Travel Ball Events"), "Tournament Fees");
  assertEq("with nothing linked, 'Tournament Fees' is used",
    q.buildBudget([line("L", "Tournament Fees", 10), line("M", "Equipment", 10)], [], [tourn("un", 5)]).unassignedCategory, "Tournament Fees");
  assertEq("with nothing linked and no tournament category, the season level row is used",
    q.buildBudget([line("L", "Equipment", 10)], [], [tourn("un", 5)]).unassignedCategory, null);
}

/* ------------------------------------------------------------------ */
console.log("H. no double counting");
{
  const items = [line("TF", "Tournament Fees", 5000)];
  // Linked tournament with payment on its line: counted once as larger-of.
  let { s } = figures(items, [tourn("a", 1000, { budget_item_id: "TF" })], [pay("a", 1000, "TF")]);
  assertEq("linked, cost 1000 and 1000 paid on its line: committed 1000, not 2000", s.committedExpenses, 1000);
  // Unlinked with payment on its tournament line category.
  ({ s } = figures(items, [tourn("a", 1000)], [pay("a", 400, "TF"), pay("a", 100, "TF", "To Pay")]));
  assertEq("unlinked, 500 recorded on a line: line holds 500, pool holds 500, total 1000", s.committedExpenses, 1000);
  // Unlinked, payment above cost
  ({ s } = figures(items, [tourn("a", 1000)], [pay("a", 1200, "TF")]));
  assertEq("unlinked, 1200 recorded above 1000 cost: counted 1200, pool 0", s.committedExpenses, 1200);
  // Considering with a payment: not committed, payment is an ordinary line expense, nothing in the pool.
  ({ s } = figures(items, [tourn("a", 1000, { decision: "Considering" })], [pay("a", 300, "TF")]));
  assertEq("Considering adds nothing to the pool; its payment is just recorded", [s.committedExpenses, s.actualExpenses], [300, 300]);
  // Declined never counts
  ({ s } = figures(items, [tourn("a", 1000, { decision: "Declined" })], []));
  assertEq("Declined adds nothing", s.committedExpenses, 0);
  // Income transactions linked to a tournament do not reduce the pool
  ({ s } = figures(items, [tourn("a", 1000)], [{ ...pay("a", 700, null), is_income: true }]));
  assertEq("income linked to a tournament does not count as a payment", s.committedExpenses, 1000);
  // $0 free tournament adds nothing, is not listed
  const free = figures(items, [tourn("f", 0)], []);
  assertEq("a free tournament adds nothing and is not an unassigned item", [free.s.committedExpenses, free.budget.unassigned.length], [0, 0]);
}

/* ------------------------------------------------------------------ */
console.log("I. $0 is a real, saved free tournament");
{
  const fd = (o) => ({ get: (k) => (k in o ? o[k] : null) });
  assertEq("typed 0 and 0 saves 0 and 0 (not null)", cost.feesFrom(fd({ entry_fee: "0", gate_fee: "0" })), { entry_fee: 0, gate_fee: 0 });
  assertEq("typed 0 with gate blank saves 0 and 0", cost.feesFrom(fd({ entry_fee: "0", gate_fee: "" })), { entry_fee: 0, gate_fee: 0 });
  assertEq("0.00 text saves 0", cost.feesFrom(fd({ entry_fee: "0.00", gate_fee: "" })).entry_fee, 0);
  assertEq("both blank still means 'not entered yet' (null)", cost.feesFrom(fd({ entry_fee: "", gate_fee: "" })), { entry_fee: null, gate_fee: null });
  assertEq("one fee entered defaults the other to 0", cost.feesFrom(fd({ entry_fee: "450", gate_fee: "" })), { entry_fee: 450, gate_fee: 0 });
  assertEq("negative or junk is treated as not entered", cost.feesFrom(fd({ entry_fee: "-5", gate_fee: "abc" })), { entry_fee: null, gate_fee: null });
}

/* ------------------------------------------------------------------ */
console.log("J. Needs action: committed tournament with no cost entered (free is fine)");
{
  const today = new Date("2027-01-01T12:00:00");
  const rows = [
    tourn("nocost", null),
    tourn("free", 0),
    tourn("priced", 500),
    tourn("paidnocost", null),
    tourn("considering", null, { decision: "Considering", start_date: "2028-01-01" }),
    tourn("past", null, { start_date: "2026-12-01" }),
  ];
  const txs = [pay("paidnocost", 300, null)];
  const a = readiness.tournamentActions(rows, today, txs);
  const c = a.find((x) => x.id === "cost");
  assertEq("every upcoming Committed tournament with no cost is flagged, including one with a partial payment; $0, priced, Considering and past are not", c?.affected.map((t) => t.id), ["nocost", "paidnocost"]);
  assertEq("filter label exists for the new action", typeof readiness.TOURNAMENT_FILTER_LABELS.cost, "string");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
