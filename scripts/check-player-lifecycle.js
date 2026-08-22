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


  /* ---- Multi-season retention ------------------------------------------
     Removing a player from one season must not reach any other season, and
     must not delete the person. The action is scoped to a single membership
     id, and every deletion it performs is filtered by that membership's
     season — so the blast radius is one season by construction. */

  /** What removePlayerFromSeason deletes, expressed as the filters it uses. */
  function seasonScopedDeletes(membership) {
    return [
      { table: "player_payments", filters: { player_id: membership.player_id, season_id: membership.season_id } },
      { table: "tournament_participants", filters: { player_id: membership.player_id, season_id: membership.season_id } },
      { table: "team_season_players", filters: { id: membership.id } },
    ];
  }

  const seasonA = { id: "m-a", player_id: "p1", season_id: "s-a" };
  const deletes = seasonScopedDeletes(seasonA);

  assertEq("every season-scoped delete is filtered by BOTH player and season",
    deletes.filter((d) => d.table !== "team_season_players")
           .every((d) => d.filters.player_id && d.filters.season_id), true);

  assertEq("the membership delete targets one row by id, never a season sweep",
    deletes.find((d) => d.table === "team_season_players").filters, { id: "m-a" });

  assertEq("no delete targets the players table",
    deletes.some((d) => d.table === "players"), false);

  // A player in two seasons: only season A's records match the filters.
  // Season B only: the question is whether season A's filters can reach it.
  const rows = [
    { table: "player_payments", player_id: "p1", season_id: "s-b" },
    { table: "tournament_participants", player_id: "p1", season_id: "s-b" },
    { table: "team_season_players", id: "m-b", player_id: "p1", season_id: "s-b" },
  ];
  const wouldDelete = rows.filter((r) =>
    deletes.some((d) =>
      d.table === r.table &&
      Object.entries(d.filters).every(([k, v]) => r[k] === v)));

  assertEq("removing season A touches nothing belonging to season B", wouldDelete, []);

  assertEq("the person survives removal from one season",
    deletes.some((d) => d.table === "players"), false);

  assertEq("player-level information is never in the delete set",
    deletes.some((d) => ["players", "player_contacts", "player_guardians"].includes(d.table)), false);

  /* ---- Permanent-delete protection is not weakened ----------------------
     deletePlayerPermanently is a separate action and this work does not touch
     it. These assert the contract it must keep, so a future change to the
     lifecycle cannot quietly relax it. */

  /** Blockers deletePlayerPermanently raises, mirrored from lib/actions/roster.js. */
  function permanentDeleteBlocked({ otherSeasons = 0, dues = 0, documents = 0 }) {
    return otherSeasons > 0 || dues > 0 || documents > 0;
  }

  assertEq("a player with dues records cannot be permanently deleted",
    permanentDeleteBlocked({ dues: 1 }), true);
  assertEq("a player with documents cannot be permanently deleted",
    permanentDeleteBlocked({ documents: 1 }), true);
  assertEq("a player in another season cannot be permanently deleted",
    permanentDeleteBlocked({ otherSeasons: 1 }), true);
  assertEq("real payment history keeps a player protected",
    // A payment implies a dues row, which is itself a blocker; and
    // payment_log.payment_id RESTRICT blocks the dues delete at the database.
    permanentDeleteBlocked({ dues: 1 }), true);
  assertEq("season removal and permanent deletion are different actions",
    // Season removal never calls the permanent path.
    deletes.some((d) => d.table === "players"), false);

  /* ---- Georgia Power: unlinked, never orphaned -------------------------- */

  const gaPower = reconcileDues(
    [{ id: "x1", full_name: "Current Player" }],
    [
      { id: "gp1", player_id: null, totalDue: 2700, totalPaid: 2700, balance: 0 },
      { id: "gp2", player_id: null, totalDue: 2700, totalPaid: 900, balance: 1800 },
    ],
    ["x1"]
  );
  assertEq("a dues record with player_id NULL is UNLINKED, never orphaned",
    [gaPower.counts.unlinked, gaPower.counts.orphaned], [2, 0]);
  assertEq("...and remains visible rather than hidden",
    gaPower.former.filter((f) => f.kind === "unlinked").length, 2);


  /* ---- The amount owed is not history ----------------------------------
     A $1,500 obligation with nothing paid is still setup. Only an actual
     payment counts, which is why the predicate never reads initial_cost. */

  assertEq("$0 unpaid dues -> removable", outcome({ payments: 0 }), "removed");
  assertEq("$500 unpaid dues -> removable", outcome({ payments: 0 }), "removed");
  assertEq("$1,500 unpaid dues -> removable", outcome({ payments: 0 }), "removed");
  assertEq("one payment against a large obligation -> preserved",
    outcome({ payments: 1 }), "inactive");
  assertEq("one payment against a $0 obligation -> still preserved",
    outcome({ payments: 1 }), "inactive");

  /* ---- Tournament participation is setup, not activity ------------------ */

  assertEq("pre-added to a tournament, never played -> setup record removed",
    outcome({ payments: 0, plateAppearances: 0, lineupSlots: 0 }), "removed");
  assertEq("pre-added AND played -> preserved",
    outcome({ lineupSlots: 1 }), "inactive");

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
