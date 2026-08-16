/**
 * Regression cases for the parent Season Budget report derivations.
 *
 * The risk this guards is not an arithmetic slip — it is publishing a number
 * to parents that quietly misrepresents the team. Two production conditions
 * drive the cases:
 *
 *   Northgate       12 active players, 12 dues records at $2,400, but one of
 *                   those records belongs to an inactive player and one active
 *                   player has none. Uniform, effectively complete.
 *   Georgia Power   13 active players and 6 dues records, every one of which
 *                   has a NULL player_id. Nothing here describes a family, and
 *                   no team total may be published.
 *
 * Run:  node scripts/check-report.js
 */
const { pathToFileURL } = require("url");
const path = require("path");

let failures = 0;
let ran = 0;

function assertEq(label, actual, expected) {
  ran += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

/** Roster of n active players: p1..pn. */
const roster = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Dues rows for the given player ids (or unlinked rows when ids is a count). */
const duesFor = (ids, amount) => ids.map((id) => ({ player_id: id, totalDue: amount }));
const duesUnlinked = (n, amount) =>
  Array.from({ length: n }, () => ({ player_id: null, totalDue: amount }));

(async () => {
  const mod = await import(pathToFileURL(path.resolve("lib/finance-rules.js")).href);
  const { duesProfile, categoryAllocation, expectedOtherIncome } = mod;

  console.log("\nParent budget report regression cases\n");

  /* --- THE REGRESSION: equal counts, wrong players -----------------------
     Northgate's real condition. 12 active players, 12 dues records, so a
     count comparison sees a complete season. It is not: Maya is active with
     no dues, and Ava is inactive but still carries one. The two errors
     cancel. This case must never pass again. */
  const active12 = roster(12);                       // p1..p12 active
  const northgate = duesProfile(
    [
      ...duesFor(active12.slice(0, 11), 2400),       // 11 active players
      { player_id: "ava-inactive", totalDue: 2400 }, // 12th record, NOT on roster
    ],
    active12
  );
  assertEq("Northgate: 12 active players", northgate.activeRosterCount, 12);
  assertEq("Northgate: only 11 active players have dues", northgate.withDues, 11);
  assertEq("Northgate: 1 active player missing dues", northgate.missingCount, 1);
  assertEq("Northgate: 1 dues record on an inactive player", northgate.inactiveWithDues, 1);
  assertEq("Northgate: status partial, not uniform", northgate.status, "partial");
  assertEq("Northgate: per-player still $2,400", northgate.perPlayer, 2400);
  assertEq("Northgate: team total SUPPRESSED", northgate.expectedTotal, null);
  assertEq("Northgate: not publishable", northgate.totalDefensible, false);
  assertEq("Northgate: active roster would owe $26,400", northgate.activeExpectedTotal, 26400);
  assertEq("Northgate: all records still total $28,800", northgate.allRecordsTotal, 28800);

  /* --- An inactive player's dues cannot fill an active player's gap ------ */
  const cancelled = duesProfile(
    [...duesFor(roster(3), 1000), { player_id: "gone", totalDue: 1000 }],
    roster(4)
  );
  assertEq("Counts equal (4 and 4) but identity says incomplete", cancelled.withDues, 3);
  assertEq("Inactive dues do not satisfy the missing active player", cancelled.missingCount, 1);
  assertEq("Total suppressed despite matching counts", cancelled.totalDefensible, false);

  /* --- Fully configured: dues set IS the active roster ------------------- */
  const complete = duesProfile(duesFor(roster(12), 2400), roster(12));
  assertEq("Complete: status uniform", complete.status, "uniform");
  assertEq("Complete: publishable", complete.totalDefensible, true);
  assertEq("Complete: $28,800", complete.expectedTotal, 28800);
  assertEq("Complete: nothing missing or stray", 
    [complete.missingCount, complete.inactiveWithDues, complete.unlinked], [0, 0, 0]);

  /* --- Georgia Power: every dues record unlinked ------------------------- */
  const gp = duesProfile(duesUnlinked(6, 2700), roster(13));
  assertEq("Georgia Power: unlinked records counted", gp.unlinked, 6);
  assertEq("Georgia Power: no linked dues, so status none", gp.status, "none");
  assertEq("Georgia Power: NO per-player figure", gp.perPlayer, null);
  assertEq("Georgia Power: NO expected total", gp.expectedTotal, null);
  assertEq("Georgia Power: total is NOT publishable", gp.totalDefensible, false);
  assertEq("Georgia Power: unlinked dues satisfy nobody", gp.withDues, 0);
  assertEq("Georgia Power: all 13 active players missing", gp.missingCount, 13);

  /* --- Partial roster: uniform amount, substantial gap ------------------- */
  const partial = duesProfile(duesFor(roster(13).slice(0, 6), 2700), roster(13));
  assertEq("Partial roster: status partial", partial.status, "partial");
  assertEq("Partial roster: per-player still stated", partial.perPlayer, 2700);
  assertEq("Partial roster: team total suppressed", partial.totalDefensible, false);
  assertEq("Partial roster: 7 missing", partial.missingCount, 7);

  /* --- Differing amounts: range, never an average ------------------------ */
  const varied = duesProfile(
    [...duesFor(roster(12).slice(0, 6), 2400), ...duesFor(roster(12).slice(6), 2700)],
    roster(12)
  );
  assertEq("Varied: status varied", varied.status, "varied");
  assertEq("Varied: no single per-player figure", varied.perPlayer, null);
  assertEq("Varied: range low", varied.min, 2400);
  assertEq("Varied: range high", varied.max, 2700);
  assertEq("Varied: no team total published", varied.totalDefensible, false);

  /* --- No dues at all ---------------------------------------------------- */
  const none = duesProfile([], roster(12));
  assertEq("No dues: status none", none.status, "none");
  assertEq("No dues: nothing publishable", none.totalDefensible, false);

  /* --- Category allocation: Northgate's real expense budget -------------- */
  const alloc = categoryAllocation([
    { category: "Tournament Fees", budgeted: 22000 },
    { category: "Player Uniforms", budgeted: 2280 },
    { category: "Coaches", budgeted: 1500 },
    { category: "Field / Facility Costs", budgeted: 1200 },
    { category: "Photography", budgeted: 1000 },
    { category: "Equipment", budgeted: 600 },
    { category: "Team Fees & Administration", budgeted: 500 },
    { category: "Team Building", budgeted: 400 },
  ]);
  assertEq("Allocation: total $29,480", alloc.total, 29480);
  assertEq("Allocation: largest first", alloc.categories[0].category, "Tournament Fees");
  assertEq("Allocation: Tournament Fees 74.6%", alloc.categories[0].percent, 74.6);
  assertEq("Allocation: percentages sum to ~100",
    Math.round(alloc.categories.reduce((n, c) => n + c.percent, 0)), 100);
  assertEq("Allocation: zero-budget categories omitted",
    categoryAllocation([{ category: "Empty", budgeted: 0 }]).categories.length, 0);

  /* --- Combined income: split and combined category naming both work ----- */
  const split = expectedOtherIncome([
    { category: "Fundraising", rows: [{ name: "Ball drop fundraiser", budgeted: 1000 },
                                      { name: "Concession stand shifts", budgeted: 500 }] },
    { category: "Sponsors", rows: [{ name: "Local business sponsorship", budgeted: 1500 }] },
  ]);
  assertEq("Income (split categories): $3,000 combined", split.total, 3000);
  assertEq("Income: three lines listed", split.lines.length, 3);

  const combined = expectedOtherIncome([
    { category: "Fundraising & Sponsors", rows: [
      { name: "Ball Drop Fundraiser", budgeted: 300 },
      { name: "Georgia Tech Concessions", budgeted: 0 },
      { name: "Raffle Tickets", budgeted: 0 },
    ] },
  ]);
  assertEq("Income (combined category): still counted", combined.total, 300);
  assertEq("Income: zero-budget lines omitted", combined.lines.length, 1);
  assertEq("Income: none at all totals zero", expectedOtherIncome([]).total, 0);

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
