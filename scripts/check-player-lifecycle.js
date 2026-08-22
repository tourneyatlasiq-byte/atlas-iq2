/**
 * Player removal lifecycle.
 *
 * The defect these guard: removing a player from a season deleted the roster
 * membership and nothing else. Dues and tournament entries have no foreign key
 * to the membership, so they survived — invisible in the UI, and counted by
 * reporting as an "inactive player" who had never been inactive. Recovering
 * one required re-adding the player, deleting the dues, and removing them
 * again.
 *
 * Run:  node scripts/check-player-lifecycle.js
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

/* ---- The history rule, mirrored from lib/actions/roster.js ---------------
   Tournament pre-adds are deliberately absent: an intention to bring someone
   to a weekend is not evidence they played it. */
function hasMeaningfulHistory({ payments = 0, transactions = 0, plateAppearances = 0, lineupSlots = 0 }) {
  return payments > 0 || transactions > 0 || plateAppearances > 0 || lineupSlots > 0;
}

const outcome = (h) => (hasMeaningfulHistory(h) ? "inactive" : "removed");

(async () => {
  const m = await import(pathToFileURL(path.resolve("lib/finance-rules.js")).href);
  const { reconcileDues } = m;

  console.log("\nPlayer removal lifecycle\n");

  /* ---- The scenarios ---------------------------------------------------- */

  assertEq("dues created, backs out, no activity -> removed entirely",
    outcome({ payments: 0, transactions: 0, plateAppearances: 0, lineupSlots: 0 }), "removed");

  assertEq("$0 dues obligation is setup, not history -> removed",
    outcome({ payments: 0 }), "removed");

  assertEq("pre-added to a tournament but never played -> still removed",
    // A tournament_participants row is not an input to the rule at all.
    outcome({ payments: 0, plateAppearances: 0, lineupSlots: 0 }), "removed");

  assertEq("one actual payment -> history preserved, marked inactive",
    outcome({ payments: 1 }), "inactive");

  assertEq("a transaction -> preserved",
    outcome({ transactions: 1 }), "inactive");

  assertEq("a tracked at-bat -> preserved",
    outcome({ plateAppearances: 1 }), "inactive");

  assertEq("a lineup appearance -> preserved",
    outcome({ lineupSlots: 1 }), "inactive");

  assertEq("payment AND at-bats -> preserved",
    outcome({ payments: 3, plateAppearances: 12 }), "inactive");

  /* ---- Reporting: an orphan is never an inactive player ------------------ */

  const active = [
    { id: "p1", full_name: "Adams" },
    { id: "p2", full_name: "Baker" },
  ];
  const memberships = ["p1", "p2", "p3"]; // p3 left the roster but still has a membership

  const payments = [
    { id: "d1", player_id: "p1", totalDue: 2400, totalPaid: 2400, balance: 0 },
    { id: "d2", player_id: "p3", totalDue: 2400, totalPaid: 600, balance: 1800,
      player: { full_name: "Carter" } },                        // former: membership exists
    { id: "d3", player_id: "p9", totalDue: 0, totalPaid: 0, balance: 0 },  // ORPHAN
    { id: "d4", player_id: null, totalDue: 2700, totalPaid: 0, balance: 2700 }, // unlinked
  ];

  const r = reconcileDues(active, payments, memberships);

  assertEq("active roster count is unaffected by any of them", r.counts.all, 2);
  assertEq("a player who left but kept a membership is FORMER", r.counts.former, 1);
  assertEq("a dues row with no player at all is UNLINKED", r.counts.unlinked, 1);
  assertEq("a dues row whose player has no membership is ORPHANED", r.counts.orphaned, 1);
  assertEq("orphaned is never counted as former",
    r.former.filter((f) => f.kind === "former").map((f) => f.playerId), ["p3"]);
  assertEq("the orphan is identified, not hidden",
    r.former.filter((f) => f.kind === "orphaned").map((f) => f.playerId), ["p9"]);

  /* ---- After the cleanup, the orphan is simply gone ---------------------- */

  const cleaned = reconcileDues(active, payments.filter((p) => p.id !== "d3"), memberships);
  assertEq("with the orphan removed, orphaned falls to zero", cleaned.counts.orphaned, 0);
  assertEq("...and nothing else moves",
    [cleaned.counts.all, cleaned.counts.former, cleaned.counts.unlinked], [2, 1, 1]);

  /* ---- Callers that do not pass memberships keep the old behaviour ------- */

  const legacy = reconcileDues(active, payments);
  assertEq("without membershipIds, classification is unchanged",
    [legacy.counts.former, legacy.counts.unlinked, legacy.counts.orphaned], [2, 1, 0]);

  /* ---- Remove -> re-add -> remove leaves nothing ------------------------- */

  assertEq("re-adding then removing again still resolves to removed",
    outcome({ payments: 0, transactions: 0, plateAppearances: 0, lineupSlots: 0 }), "removed");

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
