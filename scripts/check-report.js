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
  const { duesProfile, categoryAllocation, expectedOtherIncome, reconcileDues,
          incomeCategoryBucket, categoryOptions, resolveCategoryChoice,
          CATEGORY_OTHER, CATEGORY_OTHER_LABEL, CATEGORIES } = mod;

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

  /* ===================================================================
     Income category classification. budget_items.category is free text, so
     exact matching on "Fundraising"/"Sponsors" missed a real combined
     category and buried its money in `other`.
     =================================================================== */
  console.log("\nIncome category classification\n");

  assertEq("exact 'Fundraising'", incomeCategoryBucket("Fundraising"), "fundraising");
  assertEq("exact 'Sponsors'", incomeCategoryBucket("Sponsors"), "sponsors");
  assertEq("production combined category classifies as fundraising",
    incomeCategoryBucket("Fundraising & Sponsors"), "fundraising");
  assertEq("reversed combined category follows the author's ordering",
    incomeCategoryBucket("Sponsors & Fundraising"), "sponsors");
  assertEq("singular and plural variants", 
    ["Sponsor", "Sponsorships", "Fundraiser", "Fund-Raising"].map(incomeCategoryBucket),
    ["sponsors", "sponsors", "fundraising", "fundraising"]);
  assertEq("case and punctuation are ignored",
    ["FUNDRAISING", "fundraising/sponsors", "  Sponsors  "].map(incomeCategoryBucket),
    ["fundraising", "fundraising", "sponsors"]);
  assertEq("genuinely neither stays in other",
    ["Grants", "Concessions", "Other", ""].map(incomeCategoryBucket),
    ["other", "other", "other", "other"]);
  assertEq("null and undefined are safe",
    [incomeCategoryBucket(null), incomeCategoryBucket(undefined)], ["other", "other"]);

  /* ===================================================================
     Budget-item category selector. Was a free-text <datalist>, which gave no
     dropdown affordance — on mobile the choices were undiscoverable. Now a
     native <select>. Existing off-list categories must round-trip unchanged.
     =================================================================== */
  console.log("\nBudget category selector\n");

  // 1. Standard category
  assertEq("standard category resolves to itself",
    resolveCategoryChoice("Equipment", ""), "Equipment");
  assertEq("all known categories are offered on a new line",
    categoryOptions(undefined), CATEGORIES);

  // The duplicate-"Other" defect: "Other" is a REAL category with saved data,
  // so the custom-entry option must not be labelled the same word.
  assertEq('"Other" is a real, selectable category', CATEGORIES.includes("Other"), true);
  assertEq("custom-entry label does not collide with any category",
    CATEGORIES.some(
      (c) => c.toLowerCase().replace(/[^a-z]/g, "") ===
             CATEGORY_OTHER_LABEL.toLowerCase().replace(/[^a-z]/g, "")
    ), false);
  assertEq("exactly one option reads 'Other'",
    categoryOptions(undefined).filter((c) => c === "Other").length, 1);
  assertEq("selecting the real 'Other' stores 'Other', not the sentinel",
    resolveCategoryChoice("Other", ""), "Other");

  // 2. Custom category with a typed value
  assertEq("Other + custom name resolves to the custom name",
    resolveCategoryChoice(CATEGORY_OTHER, "Travel"), "Travel");
  assertEq("custom name is trimmed",
    resolveCategoryChoice(CATEGORY_OTHER, "  Travel  "), "Travel");
  assertEq("the sentinel is never stored as a category",
    resolveCategoryChoice(CATEGORY_OTHER, "Travel") === CATEGORY_OTHER, false);

  // 3. Editing an existing OFF-LIST category without changing it
  for (const legacy of ["Fundraising & Sponsors", "Fees & Team Building", "Tournaments"]) {
    const opts = categoryOptions(legacy);
    assertEq(`off-list "${legacy}" is offered so it can stay selected`,
      opts.includes(legacy), true);
    assertEq(`off-list "${legacy}" round-trips unchanged`,
      resolveCategoryChoice(legacy, ""), legacy);
  }
  assertEq("off-list value is added once, not duplicated",
    categoryOptions("Fundraising & Sponsors").filter((c) => c === "Fundraising & Sponsors").length, 1);
  assertEq("a known category is not duplicated when editing",
    categoryOptions("Equipment").filter((c) => c === "Equipment").length, 1);
  assertEq("known categories are all still present alongside an off-list one",
    CATEGORIES.every((c) => categoryOptions("Tournaments").includes(c)), true);

  // 4. Deliberately changing an off-list category to a standard one
  assertEq("off-list can be deliberately changed to a standard category",
    resolveCategoryChoice("Equipment", ""), "Equipment");

  // 5. Required-field behaviour
  assertEq("no selection is not a category",
    [resolveCategoryChoice("", ""), resolveCategoryChoice(null, ""), resolveCategoryChoice(undefined, "")],
    [null, null, null]);
  assertEq("Other with an empty or blank custom name is incomplete",
    [resolveCategoryChoice(CATEGORY_OTHER, ""), resolveCategoryChoice(CATEGORY_OTHER, "   ")],
    [null, null]);

  
/* ---- Finance hardening ---------------------------------------------------
   Three fixes, none of which may change a single displayed total:

     budget_items.actual was a stored money column nothing read or wrote. It
     held 33,859.00 against a season with zero transactions — a plausible
     figure with nothing behind it, waiting for a future query to SUM it.

     The Tournaments tile added committed cost with a raw float reduce while
     Finance worked in cents, so the two could disagree by a penny.

     A deleted player leaves player_payments.player_id NULL, deliberately, so
     the money survives — but the row then displayed with no name at all. */

console.log("\nFinance hardening");

{
  const fsx = require("fs");
  const rules = fsx.readFileSync("lib/finance-rules.js", "utf8");
  const tq = fsx.readFileSync("lib/queries/tournaments.js", "utf8");
  const fq = fsx.readFileSync("lib/queries/finance.js", "utf8");
  const mig = fsx.readFileSync(
    "supabase/migrations/20260830181427_drop_legacy_budget_items_actual.sql", "utf8");

  // 1. The stale column is gone, and its value was NOT converted to spending.
  assertEq("the legacy actual column is dropped",
    /alter table budget_items drop column if exists actual;/.test(mig), true);
  assertEq("...and its value was not migrated into transactions",
    /THE VALUES ARE NOT MIGRATED/.test(mig), true);
  assertEq("no query selects it", /select\("id, category, name, budgeted/.test(fq), true);
  assertEq("...and nothing writes it", /actual:/.test(fsx.readFileSync("lib/actions/finance.js", "utf8")), false);

  // 2. One cents-safe calculation for committed tournament cost.
  assertEq("the tournaments tile uses sumMoney",
    /sumMoney\(committed\.map\(\(t\) => t\.total_cost \?\? 0\)\)/.test(tq), true);
  assertEq("...and no longer reduces floats",
    /reduce\(\(sum, t\) => sum \+ Number\(t\.total_cost/.test(tq), false);
  // A tournament set that a float reduce genuinely gets wrong. Not every
  // decimal drifts — this one does, which is the point: the failure is
  // data-dependent and would surface on some seasons and not others.
  const fees = [2700.10, 2700.20, 2700.30];
  assertEq("cents-safe committed cost", sumMoney(fees), 8100.60);
  assertEq("...where a float reduce drifts",
    fees.reduce((a, b) => a + b, 0), 8100.599999999999);

  // 3. A detached obligation shows the name it was created with.
  assertEq("the stored name is the display fallback",
    /p\.player\?\.full_name \?\? p\.player_name \?\? null/.test(rules), true);
  assertEq("...and player_name is actually selected", /player_name,/.test(fq), true);

  const detached = reconcileDues(
    [{ id: "live", full_name: "Live Player" }],
    [
      { id: "o1", player_id: null, player_name: "Bohannon", player: null,
        totalDue: 2700, totalPaid: 2400, log: [] },
      { id: "o2", player_id: "live", player_name: "Old Name",
        player: { full_name: "Live Player" }, totalDue: 100, totalPaid: 0, log: [] },
      { id: "o3", player_id: null, player_name: null, player: null,
        totalDue: 50, totalPaid: 0, log: [] },
    ]
  );
  const byId = Object.fromEntries(detached.former.map((f) => [f.key, f]));
  assertEq("a deleted player's obligation shows its stored name", byId.o1.name, "Bohannon");
  assertEq("...and stays detached", byId.o1.playerId, null);
  assertEq("a record with no name at all is still honest", byId.o3.name, null);
  assertEq("a live player is unaffected by the fallback",
    detached.former.some((f) => f.key === "o2"), false);

  // Totals are untouched by any of the three.
  assertEq("the detached obligation still counts",
    sumMoney([2700, 100, 50]), 2850);
}


/* ---- Team dues allocation ------------------------------------------------
   A coach set dues for a 14-player team by typing 48000 into a field labelled
   "Total due for the season". The server wrote that amount to every player:
   14 obligations of $48,000 and a season total of $672,000, fourteen times
   what was meant. The server had always been per-player; the label was wrong,
   and one field carried two meanings.

   Money is now split in integer cents. Never floating-point division: a naive
   split of $48,000 across 14 collects $47,999.98 or $48,000.14, and the gap is
   real money a family is short or over. */

console.log("\nTeam dues allocation");

{
  const { allocateMoney, allocateCents, cents } = mod;
  const sumOf = (shares) => shares.reduce((t, v) => t + cents(v), 0);

  // The exact case from production.
  const lynch = allocateMoney(48000, 14);
  assertEq("48,000 across 14 sums to 48,000 exactly", sumOf(lynch), 4800000);
  assertEq("...as 12 at 3428.57", lynch.filter((v) => v === 3428.57).length, 12);
  assertEq("...and 2 at 3428.58", lynch.filter((v) => v === 3428.58).length, 2);

  // The split stated during planning was two cents over; the assertion in the
  // correction caught it before anything was written.
  assertEq("10x3428.57 + 4x3428.58 does NOT reconcile",
    cents(3428.57) * 10 + cents(3428.58) * 4 === 4800000, false);

  assertEq("1,000 across 3 sums to 1,000 exactly", sumOf(allocateMoney(1000, 3)), 100000);
  assertEq("...as 333.34, 333.33, 333.33",
    allocateMoney(1000, 3), [333.34, 333.33, 333.33]);

  assertEq("an even split has no remainder",
    allocateMoney(49000, 14).every((v) => v === 3500), true);
  assertEq("one cent across three still reconciles", sumOf(allocateMoney(0.01, 3)), 1);
  assertEq("zero players allocates nothing", allocateMoney(1000, 0), []);
  assertEq("a single player takes the whole total", allocateMoney(48000, 1), [48000]);

  // Deterministic: same input, same allocation, every time.
  assertEq("the allocation is deterministic",
    JSON.stringify(allocateMoney(48000, 14)) === JSON.stringify(allocateMoney(48000, 14)), true);
  assertEq("the remainder goes to the first shares",
    allocateMoney(48000, 14)[0] > allocateMoney(48000, 14)[13], true);

  // Per-player mode keeps the historical behaviour, explicitly.
  const perPlayer = Array.from({ length: 14 }, () => 3500);
  assertEq("per player x count is the displayed total", sumOf(perPlayer), 4900000);

  // A brute check that no total between 1 and 5,000 cents ever loses a penny
  // across 2..20 players.
  let mismatches = 0;
  for (let c = 1; c <= 5000; c += 7) {
    for (let n = 2; n <= 20; n += 1) {
      if (allocateCents(c, n).reduce((t, v) => t + v, 0) !== c) mismatches += 1;
    }
  }
  assertEq("no total loses or gains a cent across 2-20 players", mismatches, 0);
}

{
  const fsx = require("fs");
  const act = fsx.readFileSync("lib/actions/finance.js", "utf8");
  const ui = fsx.readFileSync("components/FinanceClient.js", "utf8");
  const conf = fsx.readFileSync("components/ConfirmAction.js", "utf8");

  assertEq("the action reads an explicit mode", /dues_mode/.test(act), true);
  assertEq("...defaulting to team total, the safer reading",
    /=== "per_player" \? "per_player" : "total"/.test(act), true);
  assertEq("...and allocates in cents for a team total",
    /allocateMoney\(entered, ordered\.length\)/.test(act), true);
  assertEq("...checking the sum before writing",
    /allocated !== cents\(entered\)/.test(act), true);
  assertEq("...over a stable order, not database order",
    /sort\(\(a, b\) =>\s*\n?\s*String\(a\.player_id\)\.localeCompare/.test(act), true);
  assertEq("no floating-point division survives in the action",
    /entered \/ (ordered|eligible|toCreate)/.test(act), false);

  assertEq("the UI offers both modes", /Amount per player/.test(ui) && /Team total/.test(ui), true);
  assertEq("...the label follows the mode",
    /duesMode === "total"\s*\n?\s*\? "Total team dues"/.test(ui), true);
  assertEq("...one player has no mode toggle",
    /isNew && effectiveScope === "all" && \(\s*\n\s*<div className="field">\s*\n\s*<label>Set dues by<\/label>/.test(ui), true);
  assertEq("the preview uses the server's own function",
    /allocateMoney\(value, n\)/.test(ui), true);
  // Now keyed on the SELECTION: deselecting everyone must also block, since
  // a team total with no payers has nobody to allocate to.
  assertEq("zero selected players cannot submit",
    /disabled=\{pending \|\| \(effectiveScope === "all" && \(isNew \? selected\.length === 0 : available\.length === 0\)\)\}/.test(ui), true);
  assertEq("the all-set state explains where to change an amount",
    /obligations with recorded payments cannot be changed in bulk/.test(ui), true);


  /* ---- Editing dues that already exist ---------------------------------
     setDuesForAll only ever creates, so a coach who set the wrong amount was
     told "Set dues for 0 players" — true, and useless. Correcting a 14-player
     team meant fourteen individual edits.

     Bulk editing is allowed only while NONE of the affected obligations has a
     payment. Not a technical limit: reallocating a team total when some
     players have already paid produces a number that is no longer the total
     the coach entered. Individual adjustment stays available and is the honest
     path once collection has begun. */

  assertEq("a bulk edit action exists", /export async function editDuesForAll/.test(act), true);
  assertEq("...refusing whole rather than in part",
    /REFUSE WHOLE, NOT IN PART/.test(act), true);
  assertEq("...when any affected obligation has a payment",
    /const paid = rows\.filter\(\(r\) => \(r\.log \?\? \[\]\)\.length > 0\)/.test(act), true);
  assertEq("...naming who blocked it", /paidNames/.test(act), true);
  assertEq("...and never partially updating",
    /if \(paid\.length > 0\) \{[\s\S]{0,600}?return \{/.test(act), true);

  assertEq("the edit allocates in cents like initial setup",
    /allocateMoney\(entered, ordered\.length\)/.test(act.slice(act.indexOf("editDuesForAll"))), true);
  assertEq("...over the same stable order",
    /String\(a\.player_id\)\.localeCompare/.test(act.slice(act.indexOf("editDuesForAll"))), true);
  assertEq("...checking the sum before writing",
    /allocated !== cents\(entered\)/.test(act.slice(act.indexOf("editDuesForAll"))), true);
  assertEq("...and it updates, never inserts",
    /\.update\(\{ initial_cost: shares\[i\] \}\)/.test(act), true);
  assertEq("...scoped to the season",
    /\.eq\("id", ordered\[i\]\.id\)\s*\n?\s*\.eq\("season_id", ctx\.season\.id\)/.test(act), true);

  // Adding a player later must not disturb anyone.
  assertEq("setting dues acts only on players who have none",
    /players\.filter\(\(p\) => !taken\.has\(p\.id\)/.test(ui), true);
  assertEq("editing team dues acts on players who have them",
    /teamEdit\s*\n?\s*\? players\.filter\(\(p\) => taken\.has\(p\.id\)/.test(ui), true);
  assertEq("the create path still only inserts missing obligations",
    /const toCreate = eligible\.filter\(\(r\) => !already\.has\(r\.player_id\)\)/.test(act), true);

  // The header stops looking like first-time setup.
  assertEq("the header states the team total once dues exist",
    /<strong>\{money\(duesTotal\)\}<\/strong> total/.test(ui), true);
  assertEq("...and offers Edit team dues when safe",
    /canBulkEdit && \(/.test(ui) && /Edit team dues/.test(ui), true);
  assertEq("...only when nothing is paid",
    /const canBulkEdit = withDues\.length > 0 && !anyPaid/.test(ui), true);
  assertEq("...explaining why when it is unavailable",
    /Team dues can no longer be reallocated as a group/.test(ui), true);
  assertEq("...and still offering dues for players who have none",
    /Set dues for \{playersWithoutDues\}/.test(ui), true);
  assertEq("the edit states what it will change",
    /This replaces the amount owed by/.test(ui), true);
  assertEq("...and that payments are untouched",
    /Payments already recorded are not affected/.test(ui), true);

  // Payment history protection is unchanged.
  assertEq("deleting a paid obligation is still refused",
    /payments have been recorded against it/i.test(act), true);


  /* ---- Exemption --------------------------------------------------------
     Two Lynch players are deliberately not charged. Deleting their obligation
     shows "Dues not set", which is indistinguishable from an oversight;
     setting 0 shows "Paid in Full", which claims money was received. Neither
     is true, so exemption is stated in its own column. */

  const rules = fsx.readFileSync("lib/finance-rules.js", "utf8");
  // Must be the FIRST branch: totalDue is 0 for an exempt player, so the
  // paid check below would otherwise claim money was received.
  assertEq("exemption is its own state", /\? "exempt"/.test(rules), true);
  assertEq("...checked before the paid branch",
    rules.indexOf('? "exempt"') < rules.indexOf('? "paid"'), true);
  assertEq("...on the record flag", /record\.exempt/.test(rules), true);
  assertEq("...counted apart from players with no dues set",
    /exempt: inState\("exempt"\)/.test(rules), true);
  assertEq("...and never reported as Paid in Full",
    /p\.exempt\s*\n?\s*\? "No dues"/.test(fsx.readFileSync("lib/queries/finance.js", "utf8")), true);

  assertEq("a team total excludes exempt players from allocation",
    /const payers = rows\.filter\(\(r\) => !r\.exempt\)/.test(act), true);
  assertEq("...refusing when nobody is left to charge",
    /Every player on this roster is marked as owing no dues/.test(act), true);
  assertEq("deselected players are recorded as exempt, not skipped",
    /exempt: true,/.test(act), true);
  assertEq("...with zero, as the constraint requires",
    /initial_cost: 0,\s*\n\s*exempt: true/.test(act), true);
  assertEq("exemption is reversible one player at a time",
    /const exempt = text\(formData\.get\("exempt"\)\) === "true"/.test(act), true);

  assertEq("the coach chooses who owes before allocating",
    /Who owes dues/.test(ui), true);
  assertEq("...defaulting to everyone", /const payerIds = payers \?\? available\.map/.test(ui), true);
  assertEq("...and the preview counts only the selected",
    /const n = selected\.length;/.test(ui), true);
  assertEq("...and says what happens to the rest",
    /will be\s*\n?\s*recorded as owing no dues/.test(ui), true);

  /* ---- Budget line is a plan, not a charge ---------------------------- */

  assertEq("creating a dues budget line reports itself",
    /duesBudget: isDuesLine/.test(act), true);
  assertEq("...only on creation, not on edit", /const isDuesLine = !id &&/.test(act), true);
  assertEq("...and the notice says nobody has been charged",
    /Players have not been charged yet/.test(ui), true);
  assertEq("...offering Set player dues when none exist",
    /Set player dues\s*\n?\s*<\/button>/.test(ui), true);
  assertEq("...and View player dues when they do",
    /View player dues/.test(ui), true);
  assertEq("...carrying the figure forward as a prefill only",
    /setDuesPrefill\(duesBudgetNotice\.amount \?\? null\)/.test(ui), true);
  assertEq("...with no automatic synchronisation afterwards",
    /NOT syncing the two\s*\n\s*\* afterwards/.test(act), true);


  /* ---- Budget delete ----------------------------------------------------
     Clicking Delete did nothing visible. The handler fired and the state
     changed; BudgetTab simply never passed the confirmation props on, so
     nothing rendered. The earlier scroll-into-view change was aimed at the
     wrong cause and had no effect. */

  assertEq("BudgetTab destructures the confirmation props",
    /onDelete, pending,\s*\n\s*confirmingDelete = null, onCancelDelete, onConfirmDelete, deleteError = null \}\)/.test(ui), true);
  assertEq("...and passes them to BudgetSection",
    /confirmingDelete=\{confirmingDelete\}/.test(ui), true);

  assertEq("a row-level delete uses the modal, not the inline form",
    /export function ConfirmDialog/.test(conf), true);
  assertEq("...rendered outside the collapsible groups, so collapsing cannot unmount it",
    ui.indexOf("{confirmRow && (") > ui.lastIndexOf("{open &&"), true);
  assertEq("...resolving the row across every category",
    /groups\.flatMap\(\(g\) => g\.rows\)\.find/.test(ui), true);
  assertEq("...and no inline confirmation remains on a budget row",
    /confirmingDelete === `budget:\$\{r\.id\}`/.test(ui), false);

  assertEq("escape cancels the dialog", /e\.key === "Escape" && !pending/.test(conf), true);
  assertEq("...but not while the request is running",
    /onClick=\{pending \? undefined : onCancel\}/.test(conf), true);
  assertEq("...and both buttons are disabled in flight",
    (conf.match(/disabled=\{pending\}/g) || []).length >= 2, true);
  assertEq("cancelling deletes nothing",
    /onCancel=\{onCancelDelete\}/.test(ui), true);
  assertEq("confirming passes the resolved row",
    /onConfirm=\{\(\) => onConfirmDelete\(confirmRow\)\}/.test(ui), true);
  // The guard refuses and asks where the transactions should go, rather than
  // deleting financial history along with the line.
  assertEq("a referenced line is still protected",
    /filed against this budget line\. Move them to another line first/.test(act), true);
  assertEq("...offering reassignment rather than deletion",
    /needsReassign: true/.test(act), true);

  assertEq("an inline confirmation scrolls itself into view",
    /scrollIntoView\(\{ block: "nearest"/.test(conf), true);
}

console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
