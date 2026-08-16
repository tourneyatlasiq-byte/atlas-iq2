/**
 * Regression cases for the Tournament Schedule report rules.
 *
 * The risk is printing something a parent will act on and find wrong: a game
 * under the wrong tournament, a date off by one, or a placeholder where the
 * product simply has no data.
 *
 * Run:  node scripts/check-schedule.js
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

(async () => {
  const m = await import(pathToFileURL(path.resolve("lib/schedule-rules.js")).href);
  const {
    isGameWithinTournament, compareGames, compareTournaments,
    formatDateRange, formatDayLabel, formatClock, groupGamesByDate, parseDate,
  } = m;

  console.log("\nTournament Schedule rules\n");

  /* --- Dates parse as LOCAL, never UTC ---------------------------------- */
  const d = parseDate("2026-08-05");
  assertEq("a plain date keeps its day (UTC parsing would shift it)",
    [d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 8, 5]);
  assertEq("Aug 5 2026 is a Wednesday", formatDayLabel("2026-08-05"), "Wed Aug 5");

  /* --- Out-of-range games: the six known production cases ---------------- */
  // TC Veterans Tribute is Nov 6-8; four QAB test games are dated Aug 16.
  assertEq("game before the tournament is excluded",
    isGameWithinTournament("2026-08-16", "2026-11-06", "2026-11-08"), false);
  // Rome Fall Invitational, Nov 7-8, with a game dated Aug 4.
  assertEq("another early game is excluded",
    isGameWithinTournament("2026-08-04", "2026-11-07", "2026-11-08"), false);
  assertEq("game after the tournament is excluded",
    isGameWithinTournament("2026-11-20", "2026-11-06", "2026-11-08"), false);
  assertEq("game on the first day is included",
    isGameWithinTournament("2026-08-05", "2026-08-05", "2026-08-06"), true);
  assertEq("game on the last day is included",
    isGameWithinTournament("2026-08-06", "2026-08-05", "2026-08-06"), true);
  assertEq("a game with no date is excluded",
    isGameWithinTournament(null, "2026-08-05", "2026-08-06"), false);
  assertEq("a missing tournament bound does not exclude on that side",
    [isGameWithinTournament("2026-08-05", null, "2026-08-06"),
     isGameWithinTournament("2026-08-05", "2026-08-05", null)], [true, true]);

  /* --- Game ordering: nulls last -------------------------------------- */
  const games = [
    { id: "c", date: "2026-08-05", startTime: null },
    { id: "a", date: "2026-08-05", startTime: "13:20:00" },
    { id: "b", date: "2026-08-05", startTime: "09:20:00" },
    { id: "d", date: "2026-08-04", startTime: null },
  ];
  assertEq("date first, then time, with untimed games last",
    [...games].sort(compareGames).map((g) => g.id), ["d", "b", "a", "c"]);

  const tied = [
    { id: "zz", date: "2026-08-05", startTime: null },
    { id: "aa", date: "2026-08-05", startTime: null },
  ];
  assertEq("two untimed games on one day order stably by id",
    [...tied].sort(compareGames).map((g) => g.id), ["aa", "zz"]);

  /* --- Tournament ordering --------------------------------------------- */
  const ts = [
    { name: "Winter Warm-Up", startDate: "2027-01-16" },
    { name: "Fall Kickoff Classic", startDate: "2026-08-05" },
    { name: "B Event", startDate: "2026-08-05" },
  ];
  assertEq("start date, then name",
    [...ts].sort(compareTournaments).map((t) => t.name),
    ["B Event", "Fall Kickoff Classic", "Winter Warm-Up"]);

  /* --- Date ranges ------------------------------------------------------ */
  assertEq("same month", formatDateRange("2026-08-05", "2026-08-06"), "Aug 5–6, 2026");
  assertEq("single day", formatDateRange("2026-11-21", "2026-11-21"), "Nov 21, 2026");
  assertEq("no end date falls back to the start", formatDateRange("2026-11-21", null), "Nov 21, 2026");
  assertEq("across months", formatDateRange("2026-10-30", "2026-11-01"), "Oct 30 – Nov 1, 2026");
  assertEq("across years",
    formatDateRange("2026-12-30", "2027-01-02"), "Dec 30, 2026 – Jan 2, 2027");
  assertEq("no start date yields nothing rather than a guess",
    formatDateRange(null, "2026-11-08"), null);

  /* --- Times: absent is absent, never a placeholder --------------------- */
  assertEq("morning", formatClock("09:20:00"), "9:20 AM");
  assertEq("afternoon", formatClock("13:20:00"), "1:20 PM");
  assertEq("noon and midnight",
    [formatClock("12:00:00"), formatClock("00:30:00")], ["12:00 PM", "12:30 AM"]);
  assertEq("a missing time stays null",
    [formatClock(null), formatClock(""), formatClock(undefined)], [null, null, null]);
  assertEq("a malformed time is not rendered", formatClock("not-a-time"), null);

  /* --- Grouping multiple games on one day ------------------------------- */
  const grouped = groupGamesByDate([
    { id: "1", date: "2026-08-05" },
    { id: "2", date: "2026-08-05" },
    { id: "3", date: "2026-08-06" },
  ]);
  assertEq("two days, with two games on the first",
    grouped.map((d2) => [d2.date, d2.games.length]),
    [["2026-08-05", 2], ["2026-08-06", 1]]);
  assertEq("no games groups to nothing", groupGamesByDate([]), []);

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
