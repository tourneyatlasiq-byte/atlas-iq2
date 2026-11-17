/**
 * Tournament QAB summary: the pure rules (2026-11).
 *
 * Runs the real helpers in lib/qab-rules.js with the Mower Fixture Weekend Classic
 * values Autumn approved (production, read-only, 2026-11-17):
 *
 *   Fixture Weekend Classic  81 QAB / 149 PA = 54.4%   (G1 to G6, Sat 14 / Sun 15 Nov)
 *   day 1 30/65 = 46.2%   day 2 51/84 = 60.7%
 *   highest G4 18/28 = 64.3%   lowest G3 9/25 = 36.0%
 *   previous tracked tournament: Previous Weekend Classic, 51/108 = 47.2%
 *
 *   A. Day groups: tracked games only, two or more distinct dates
 *   B. Highest and lowest QAB% game: ties, equal, too few games
 *   C. Previous tracked tournament: first tournament, ties, no date
 *   D. Alphabetical player order (name as printed)
 *   E. Final-score text
 *
 * Run:  node scripts/check-qab-summary-rules.js
 */
const { pathToFileURL } = require("url");
const path = require("path");
const fs = require("fs");
const os = require("os");

let ran = 0, failures = 0;
function assertEq(label, actual, expected) {
  ran += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures += 1; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  else console.log(`  ok    ${label}`);
}

(async () => {
  console.log("\nTournament QAB summary rules\n");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qab-sum-"));
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, "..", "lib", "qab-rules.js"), path.join(root, "lib", "qab-rules.js"));
  const R = await import(pathToFileURL(path.join(root, "lib", "qab-rules.js")).href);

  // The six Pack games, in order. gameDate drives the day groups.
  const PACK = [
    { number: 1, gameDate: "2026-11-14", qab: 10, pa: 21 },
    { number: 2, gameDate: "2026-11-14", qab: 11, pa: 19 },
    { number: 3, gameDate: "2026-11-14", qab: 9, pa: 25 },
    { number: 4, gameDate: "2026-11-15", qab: 18, pa: 28 },
    { number: 5, gameDate: "2026-11-15", qab: 17, pa: 30 },
    { number: 6, gameDate: "2026-11-15", qab: 16, pa: 26 },
  ].map((g) => ({ ...g, qabPct: R.qabPercent(g.qab, g.pa) }));

  console.log("A. Day groups");
  assertEq("exports exist", ["qabDayGroups", "qabExtremes", "previousTournament", "compareNamesAlphabetical", "formatScoreline"].map((k) => typeof R[k]), Array(5).fill("function"));
  assertEq("a two-day tournament groups by tracked game date: Sat 30/65 46.2, Sun 51/84 60.7",
    R.qabDayGroups(PACK)?.map((d) => `${d.date} ${d.qab}/${d.pa} ${d.qabPct} g${d.games}`),
    ["2026-11-14 30/65 46.2 g3", "2026-11-15 51/84 60.7 g3"]);
  assertEq("the days total the tournament (81/149)",
    [R.qabDayGroups(PACK).reduce((n, d) => n + d.qab, 0), R.qabDayGroups(PACK).reduce((n, d) => n + d.pa, 0)], [81, 149]);
  assertEq("a single-day tournament has no day block", R.qabDayGroups(PACK.slice(0, 3)), null);
  assertEq("one tracked game has no day block", R.qabDayGroups(PACK.slice(0, 1)), null);
  assertEq("no games has no day block", R.qabDayGroups([]), null);
  assertEq("games without a date are left out of the days, and can not make a second day",
    R.qabDayGroups([...PACK.slice(0, 3), { number: 7, gameDate: null, qab: 5, pa: 10, qabPct: 50 }]), null);
  assertEq("days follow the calendar even if the input is out of order",
    R.qabDayGroups([PACK[3], PACK[0]]).map((d) => d.date), ["2026-11-14", "2026-11-15"]);
  assertEq("three calendar days give three groups",
    R.qabDayGroups([...PACK, { number: 7, gameDate: "2026-11-16", qab: 1, pa: 4, qabPct: 25 }]).length, 3);

  console.log("B. Highest and lowest QAB% game");
  const ex = R.qabExtremes(PACK);
  assertEq("highest is G4 64.3, lowest is G3 36.0", [ex.highest.number, ex.highest.qabPct, ex.lowest.number, ex.lowest.qabPct], [4, 64.3, 3, 36]);
  assertEq("tied percentages go to the earlier game",
    (({ highest, lowest }) => [highest.number, lowest.number])(R.qabExtremes([
      { number: 1, qab: 5, pa: 10, qabPct: 50 }, { number: 2, qab: 8, pa: 10, qabPct: 80 }, { number: 3, qab: 8, pa: 10, qabPct: 80 },
      { number: 4, qab: 2, pa: 10, qabPct: 20 }, { number: 5, qab: 2, pa: 10, qabPct: 20 }])), [2, 4]);
  assertEq("every game equal: no highest or lowest to name", R.qabExtremes([{ number: 1, qab: 5, pa: 10, qabPct: 50 }, { number: 2, qab: 6, pa: 12, qabPct: 50 }]), null);
  assertEq("one game: no highest or lowest", R.qabExtremes(PACK.slice(0, 1)), null);
  assertEq("no games: no highest or lowest", R.qabExtremes([]), null);
  assertEq("a game with no plate appearances never becomes the lowest",
    R.qabExtremes([...PACK, { number: 7, qab: 0, pa: 0, qabPct: null }]).lowest.number, 3);

  console.log("C. Previous tracked tournament");
  const TRACKED = [
    { id: "pack", name: "Fixture Weekend Classic", startDate: "2026-11-14" },
    { id: "tc", name: "Previous Weekend Classic", startDate: "2026-11-07" },
    { id: "oct", name: "Earlier Fixture Classic", startDate: "2026-10-17" },
  ];
  assertEq("previous of the weekend is the closest earlier tracked tournament: Previous Weekend Classic",
    R.previousTournament(TRACKED, TRACKED[0]), { id: "tc", name: "Previous Weekend Classic" });
  assertEq("previous of the second weekend is the earlier classic", R.previousTournament(TRACKED, TRACKED[1]), { id: "oct", name: "Earlier Fixture Classic" });
  assertEq("the first tournament has no previous", R.previousTournament(TRACKED, TRACKED[2]), null);
  assertEq("a tournament with no start date has no previous", R.previousTournament(TRACKED, { id: "x", startDate: null }), null);
  assertEq("a tournament starting the same day is not 'previous'",
    R.previousTournament([...TRACKED, { id: "same", name: "Same Day", startDate: "2026-11-14" }], TRACKED[0]), { id: "tc", name: "Previous Weekend Classic" });
  assertEq("candidates without a start date are skipped",
    R.previousTournament([...TRACKED, { id: "nodate", name: "No Date", startDate: null }], TRACKED[0]), { id: "tc", name: "Previous Weekend Classic" });
  assertEq("a later tournament is never previous", R.previousTournament(TRACKED.slice(0, 1), TRACKED[0]), null);

  console.log("D. Alphabetical players (name as printed, first name first)");
  const names = ["Juniper Voss", "Aspen Hale", "garnet Pike", "Cedar Finch", "Briar Cole", "Éloise Ray"];
  assertEq("sorted by the name as printed, case and accents sensible",
    [...names].sort(R.compareNamesAlphabetical), ["Aspen Hale", "Briar Cole", "Cedar Finch", "Éloise Ray", "garnet Pike", "Juniper Voss"]);
  assertEq("equal names compare equal", R.compareNamesAlphabetical("Aspen Hale", "Aspen Hale"), 0);
  assertEq("a missing name never throws", [R.compareNamesAlphabetical(null, "A"), R.compareNamesAlphabetical("A", undefined)].map(Math.sign), [-1, 1]);

  console.log("E. Score text");
  assertEq("scored game", [R.formatScoreline(4, 6), R.formatScoreline(12, 0), R.formatScoreline(0, 0)], ["4–6", "12–0", "0–0"]);
  assertEq("no score unless both runs are numbers", [R.formatScoreline(null, 3), R.formatScoreline(3, undefined), R.formatScoreline(null, null)], [null, null, null]);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
