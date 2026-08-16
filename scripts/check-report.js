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
  const { duesProfile, categoryAllocation, expectedOtherIncome, reconcileDues } = mod;

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
  assertEq("Northgate blocks because MAYA is missing, not because of Ava",
    northgate.identityComplete, false);
  assertEq("Northgate: once Maya has dues it generates",
    duesProfile([...duesFor(roster(12), 2400), { player_id: "ava", totalDue: 2400 }], roster(12))
      .identityComplete, true);
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

  /* --- A legitimate inactive-player record must NOT block --------------
     Production case: a player paid $2,400 in full across six installments,
     then left the roster. Requiring that record to be absent would mean
     deleting real financial history to print a report. */
  const withDeparted = duesProfile(
    [...duesFor(roster(12), 2400), { player_id: "ava-departed", totalDue: 2400 }],
    roster(12)
  );
  assertEq("Departed player's dues do NOT block", withDeparted.identityComplete, true);
  assertEq("Departed player counted separately", withDeparted.inactiveWithDues, 1);
  assertEq("Departed player excluded from the report total", withDeparted.expectedTotal, 28800);
  assertEq("Report total is 12 x $2,400, not 13", withDeparted.expectedTotal, 12 * 2400);
  assertEq("Finance's all-records figure still includes them", withDeparted.allRecordsTotal, 31200);
  assertEq("Departed player not counted as active", withDeparted.withDues, 12);

  /* --- An unlinked record must not block or contaminate ------------------ */
  const withUnlinked = duesProfile(
    [...duesFor(roster(12), 2400), ...duesUnlinked(2, 999)],
    roster(12)
  );
  assertEq("Unlinked records do NOT block", withUnlinked.identityComplete, true);
  assertEq("Unlinked records counted separately", withUnlinked.unlinked, 2);
  assertEq("Unlinked amounts excluded from the report total", withUnlinked.expectedTotal, 28800);
  assertEq("Unlinked amounts do not affect per-player", withUnlinked.perPlayer, 2400);
  assertEq("Unlinked amounts do not widen the range", [withUnlinked.min, withUnlinked.max], [2400, 2400]);

  /* --- Both at once, which is the realistic long-running season ---------- */
  const messyButValid = duesProfile(
    [...duesFor(roster(12), 2400), { player_id: "departed", totalDue: 2400 }, ...duesUnlinked(1, 500)],
    roster(12)
  );
  assertEq("Departed + unlinked together still generate", messyButValid.identityComplete, true);
  assertEq("Report total unaffected by either", messyButValid.expectedTotal, 28800);

  /* --- A missing ACTIVE player still blocks ------------------------------ */
  const stillBlocks = duesProfile(duesFor(roster(11), 2400), roster(12));
  assertEq("Missing active player STILL blocks", stillBlocks.identityComplete, false);
  assertEq("Missing active player: no total", stillBlocks.expectedTotal, null);

  /* --- identityComplete gates GENERATION; totalDefensible gates the total.
     A roster can be fully reconciled while players legitimately owe different
     amounts: the report generates, the team total does not print. */
  const variedButComplete = duesProfile(
    [...duesFor(roster(12).slice(0, 6), 2400), ...duesFor(roster(12).slice(6), 2700)],
    roster(12)
  );
  assertEq("Varied but reconciled: generation allowed", variedButComplete.identityComplete, true);
  assertEq("Varied but reconciled: total still suppressed", variedButComplete.totalDefensible, false);

  /* --- Fully configured: dues set IS the active roster ------------------- */
  const complete = duesProfile(duesFor(roster(12), 2400), roster(12));
  assertEq("Complete: status uniform", complete.status, "uniform");
  assertEq("Complete: publishable", complete.totalDefensible, true);
  assertEq("Complete: $28,800", complete.expectedTotal, 28800);
  assertEq("Complete: nothing missing or stray",
    [complete.missingCount, complete.inactiveWithDues, complete.unlinked], [0, 0, 0]);
  assertEq("Complete: reconciled, so generation allowed", complete.identityComplete, true);

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

  /* ===================================================================
     Player Dues roster reconciliation — Northgate's exact production shape.
     12 active players, 12 dues records, but Maya has none and Ava's belongs
     to a player who has left. Counts previously cancelled and hid both.
     =================================================================== */
  console.log("\nPlayer Dues roster reconciliation\n");

  const NG_ACTIVE = [
    "Bella Ramos", "Cora Lindqvist", "Delaney Boyd", "Elle Nakamura",
    "Faith Okonkwo", "Gia Castellano", "Hannah Devereux", "Iris Kaminski",
    "Jada Sinclair", "Kira Alsobrook", "Lena Marchetti", "Maya Okafor",
  ].map((full_name, i) => ({ id: `pl${i + 1}`, full_name }));

  const rec = (playerId, due, paid, id) => ({
    id: id ?? `rec-${playerId}`,
    player_id: playerId,
    player: { full_name: NG_ACTIVE.find((p) => p.id === playerId)?.full_name ?? "Ava Whitfield" },
    totalDue: due, totalPaid: paid, balance: due - paid,
  });

  const NG_PAYMENTS = [
    rec("pl1", 2400, 2400),   // Bella — paid in full
    rec("pl2", 2400, 700),
    rec("pl3", 2400, 1200),
    rec("pl4", 2400, 700),
    rec("pl5", 2400, 700),
    rec("pl6", 2400, 400),
    rec("pl7", 2400, 400),
    rec("pl8", 2400, 0),
    rec("pl9", 2400, 0),
    rec("pl10", 2400, 0),
    rec("pl11", 2400, 0),
    // Maya (pl12) deliberately absent.
    { id: "rec-ava", player_id: "ava", player: { full_name: "Ava Whitfield" },
      totalDue: 2400, totalPaid: 2400, balance: 0 },
  ];

  const ng = reconcileDues(NG_ACTIVE, NG_PAYMENTS);

  assertEq("Roster is the spine: all 12 active players appear", ng.roster.length, 12);
  assertEq("Every active player is present by name",
    ng.roster.map((r) => r.name),
    NG_ACTIVE.map((p) => p.full_name).sort((a, b) => a.localeCompare(b)));

  /* 1. Active player with no player_payments row */
  const maya = ng.roster.find((r) => r.name === "Maya Okafor");
  assertEq("Maya appears as a row, not a missing record", Boolean(maya), true);
  assertEq("Maya's state is 'not-set'", maya.state, "not-set");
  assertEq("Maya has no attached record", maya.record, null);

  /* 2. Inactive player with legitimate payment history */
  assertEq("Ava is NOT in the roster view",
    ng.roster.some((r) => r.name === "Ava Whitfield"), false);
  assertEq("Ava is in Former / unlinked", ng.former.length, 1);
  assertEq("Ava is labelled 'former', never 'unlinked'", ng.former[0].kind, "former");
  assertEq("Ava keeps her name", ng.former[0].name, "Ava Whitfield");
  assertEq("Ava keeps her $2,400 paid in full",
    [ng.former[0].record.totalDue, ng.former[0].record.totalPaid, ng.former[0].record.balance],
    [2400, 2400, 0]);

  /* 3. Counts describe the roster, not the record count */
  assertEq("All = 12 active players (not 12 records)", ng.counts.all, 12);
  assertEq("Paid = 1 (Bella only, not Ava)", ng.counts.paid, 1);
  assertEq("Owes balance = 10", ng.counts.owes, 10);
  assertEq("Not started = 4", ng.counts.notStarted, 4);
  assertEq("Dues not set = 1 (Maya)", ng.counts.notSet, 1);
  assertEq("Former = 1, unlinked = 0", [ng.counts.former, ng.counts.unlinked], [1, 0]);
  assertEq("Bella is the only Paid player",
    ng.roster.filter((r) => r.state === "paid").map((r) => r.name), ["Bella Ramos"]);

  assertEq("Roster states partition All: paid + owes + notSet = 12",
    ng.counts.paid + ng.counts.owes + ng.counts.notSet, 12);
  assertEq("Not started OVERLAPS owes, by design",
    ng.roster.filter((r) => r.state === "not-started").every((r) => r.record.balance > 0), true);

  /* 4. Equal counts, mismatched identities — the original defect */
  assertEq("12 active and 12 records, yet one player has none and one record is former",
    [NG_ACTIVE.length, NG_PAYMENTS.length, ng.counts.notSet, ng.counts.former],
    [12, 12, 1, 1]);

  /* 5. NULL player_id records (Georgia Power) */
  const gpRoster = reconcileDues(
    Array.from({ length: 13 }, (_, i) => ({ id: `g${i}`, full_name: `GP Player ${i}` })),
    Array.from({ length: 6 }, (_, i) => ({
      id: `u${i}`, player_id: null, player: null,
      totalDue: 2700, totalPaid: 2700, balance: 0,
    }))
  );
  assertEq("GP: all 13 active players appear", gpRoster.counts.all, 13);
  assertEq("GP: all 13 show dues not set", gpRoster.counts.notSet, 13);
  assertEq("GP: 6 unlinked records are reachable", gpRoster.counts.unlinked, 6);
  assertEq("GP: unlinked records are not called 'former'", gpRoster.counts.former, 0);
  assertEq("GP: unlinked records never masquerade as active players",
    gpRoster.roster.some((r) => r.record), false);

  /* 6. Amounts are read, never altered */
  assertEq("Every attached record is the same object that came in",
    ng.roster.filter((r) => r.record)
      .every((r) => NG_PAYMENTS.includes(r.record)), true);
  assertEq("Total dollars across roster + former is unchanged",
    [...ng.roster.filter((r) => r.record).map((r) => r.record.totalDue),
     ...ng.former.map((f) => f.record.totalDue)].reduce((a, b) => a + b, 0),
    NG_PAYMENTS.reduce((a, p) => a + p.totalDue, 0));

  /* ===================================================================
     Money arithmetic: integer cents, not float addition.
     Whole-dollar data hid this. 0.1+0.2 !== 0.3 in binary floating point,
     and these figures reach a parent-facing report.
     =================================================================== */
  console.log("\nCurrency aggregation\n");
  const { sumMoney, toCents } = mod;

  assertEq("0.1 + 0.2 === 0.3 (float gives 0.30000000000000004)",
    sumMoney([0.1, 0.2]), 0.3);
  assertEq("three x 33.33 === 99.99", sumMoney([33.33, 33.33, 33.33]), 99.99);
  assertEq("0.1 + 0.2 + 0.3 === 0.6 (float gives 0.6000000000000001)",
    sumMoney([0.1, 0.2, 0.3]), 0.6);
  assertEq("99.99 - 33.33 - 33.33 - 33.33 === 0 exactly",
    sumMoney([99.99, -33.33, -33.33, -33.33]), 0);
  assertEq("a cent survives a large total", sumMoney([29480, 0.01]), 29480.01);
  assertEq("negative remainders are exact", sumMoney([100.10, -100.20]), -0.1);
  assertEq("toCents rounds half away from zero, not by float luck",
    [toCents(2400), toCents(33.335), toCents(0.005)], [2400, 33.34, 0.01]);

  // The float versions these replaced, kept as a record of what was wrong.
  assertEq("float baseline really does drift (documents the defect)",
    [0.1 + 0.2 === 0.3, 0.1 + 0.2 + 0.3 === 0.6], [false, false]);

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
