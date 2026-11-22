/**
 * Season by tournament and player game dots (2026-11). PURE rules, no database.
 *
 * Pins the rules that decide what a coach reads:
 *   - a QAB figure is only ever built from recorded plate appearances; a game
 *     where the player did not bat is "no PA recorded", never a zero
 *   - "Tracking in progress" comes from the game's explicit completion flag,
 *     never from tournament dates
 *   - a player's bar is provisional only when HER figures include an unfinished
 *     game; the tournament-wide status is separate
 *   - no ids leave the rows; names and aggregate counts only
 *   - dots: stable order, no implied sequence within a day without start times
 *
 * Run:  node scripts/check-qab-tournament-rows.js
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
function ok(label, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) passed++; else failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${pass ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const R = require(path.join(ROOT, "lib/qab-tournament-rows.js"));

// ---- fixtures: Lynch-shaped data (ids are fake; the rules must never emit them)
const g = (gameId, gameDate, startTime, tournamentId, tournament, opponent, qab, pa, completed = true) =>
  ({ gameId, gameDate, startTime, tournamentId, tournament, opponent, qab, pa, completed });
const games = [
  g("g1", "2026-11-06", null, "tA", "T25 (Scenic)", "Corona Angels", 18, 32),
  g("g2", "2026-11-06", null, "tA", "T25 (Scenic)", "Athletics Mercado", 18, 29),
  g("g3", "2026-11-07", null, "tA", "T25 (Scenic)", "Top Gun National", 16, 27),
  g("g4", "2026-11-13", "16:00:00", "tB", "A Very Long Tournament Name That Will Need To Wrap Cleanly On A Phone", "Texas Blaze", 9, 25),
  g("g5", "2026-11-13", "18:00:00", "tB", "A Very Long Tournament Name That Will Need To Wrap Cleanly On A Phone", "Unity Torres", 15, 30),
  g("g6", "2026-11-21", "11:30:00", "tC", "Show Me The Money", "Top Gun Sciara", 12, 23),
  g("g7", "2026-11-21", "16:45:00", "tC", "Show Me The Money", "Team Long Island", 15, 25, false),
  g("g8", "2026-11-28", null, null, null, "Scrimmage Stars", 3, 8),
];

// ---- team rows
const rows = R.tournamentRows(games);
ok("one row per tournament plus one for games outside any tournament", rows.map((r) => r.name), ["T25 (Scenic)", "A Very Long Tournament Name That Will Need To Wrap Cleanly On A Phone", "Show Me The Money", "Not in a tournament"]);
ok("aggregates are plain sums of recorded games", rows.map((r) => [r.games, r.qab, r.pa]), [[3, 52, 88], [2, 24, 55], [2, 27, 48], [1, 3, 8]]);
ok("QAB% uses the existing one-decimal rule", rows.map((r) => r.qabPct), [59.1, 43.6, 56.3, 37.5]);
ok("rows reconcile to the season totals", [rows.reduce((n, r) => n + r.qab, 0), rows.reduce((n, r) => n + r.pa, 0)], [games.reduce((n, x) => n + x.qab, 0), games.reduce((n, x) => n + x.pa, 0)]);
ok("only the tournament with an unfinished game is Tracking in progress", rows.map((r) => r.trackingInProgress), [false, false, true, false]);
ok("a team row includes an unfinished game when one has PA", rows.map((r) => r.includesUnfinished), [false, false, true, false]);
ok("no id or key leaves a row", rows.every((r) => !JSON.stringify(r).match(/"(id|tournamentId|gameId|key)"|tA|tB|tC|g[0-9]/)));
ok("rows are chronological by first game, outside-tournament last", rows.map((r) => r.firstDate), ["2026-11-06", "2026-11-13", "2026-11-21", "2026-11-28"]);
ok("date label is built from tracked games, never tournament dates", rows.map((r) => R.tournamentDateLabel(r.firstDate, r.lastDate)), ["Nov 6 to 7", "Nov 13", "Nov 21", "Nov 28"]);
ok("a range across months", R.tournamentDateLabel("2026-11-30", "2026-12-02"), "Nov 30 to Dec 2");
ok("no games means no rows", R.tournamentRows([]), []);
ok("tournament completion is not inferred from dates: finishing the game ends the label", R.tournamentRows(games.map((x) => ({ ...x, completed: true }))).map((r) => r.trackingInProgress), [false, false, false, false]);
ok("Season report rows hide tournaments when there is only one", R.showTournamentRows(R.tournamentRows(games.slice(0, 3))), false);
ok("and show them from two", R.showTournamentRows(rows), true);

// ---- player rows and dots
const hist = (list) => list.map(([gameId, qab, pa]) => ({ gameId, qab, pa }));
// Kenzi-shaped: batted in g1, g2; no PA in g3; in T-B batted both; tC: batted in g7 (unfinished), none in g6
const kenzi = hist([["g1", 2, 2], ["g2", 0, 2], ["g4", 1, 2], ["g5", 1, 2], ["g7", 1, 2]]);
const P = R.playerTournamentView(games, kenzi);
ok("player rows follow the same tournaments", P.rows.map((r) => r.name), rows.map((r) => r.name));
ok("player QAB/PA and games with a PA come from her own history only", P.rows.map((r) => [r.qab, r.pa, r.gamesWithPa, r.gamesWithQab]), [[2, 4, 2, 1], [2, 4, 2, 2], [1, 2, 1, 1], [0, 0, 0, 0]]);
ok("zero PA in a tournament is a row with no percentage", [P.rows[3].pa, P.rows[3].qabPct], [0, null]);
ok("her bar is provisional only where HER figures include an unfinished game", P.rows.map((r) => r.includesUnfinished), [false, false, true, false]);
ok("tournament-wide status stays separate", P.rows.map((r) => r.trackingInProgress), [false, false, true, false]);
const noPaInUnfinished = R.playerTournamentView(games, hist([["g1", 1, 2], ["g6", 1, 2]]));
ok("a player with no PA in the unfinished game: tournament still Tracking in progress, bar not provisional", [noPaInUnfinished.rows[2].trackingInProgress, noPaInUnfinished.rows[2].includesUnfinished], [true, false]);
ok("provisional note once: true only when some bar includes an unfinished game", [P.anyProvisional, noPaInUnfinished.anyProvisional], [true, false]);
ok("text count: QAB in x of y games with a PA", [P.gamesWithQab, P.gamesWithPa], [5 === 5 ? 4 : 0, 5]);
ok("a no-QAB game with PA is counted in the denominator", P.gamesWithQab < P.gamesWithPa, true);
const statuses = P.dots.flatMap((t) => t.days.flatMap((d) => d.games.map((x) => `${x.gameId}:${x.status}`)));
ok("dots: qab recorded, batted with no QAB, and no recorded PA are three different states", statuses, ["g2:noqab", "g1:qab", "g3:nopa", "g4:qab", "g5:qab", "g6:nopa", "g7:qab", "g8:nopa"]);
ok("a game with no PA is never given a PA count", P.dots[0].days[1].games[0].pa, 0);
ok("dotted outline only where her figures include an unfinished game", P.dots.flatMap((t) => t.days.flatMap((d) => d.games.filter((x) => x.unfinished).map((x) => x.gameId))), ["g7"]);
ok("no-PA game in an unfinished game is not marked unfinished", R.playerTournamentView(games, hist([["g1", 1, 2]])).dots[2].days[0].games.map((x) => x.unfinished), [false, false]);
ok("each dot carries a date and opponent for the tap readout and accessible label", P.dots[0].days[0].games[1].label, "Nov 6, vs Corona Angels: QAB recorded, 2 QAB in 2 PA");
ok("no-PA label", P.dots[0].days[1].games[0].label, "Nov 7, vs Top Gun National: no plate appearance recorded for this player");
ok("batted with no QAB label", P.dots[0].days[0].games[0].label, "Nov 6, vs Athletics Mercado: batted, no QAB recorded, 0 QAB in 2 PA");
ok("unfinished label says Tracking in progress", P.dots[2].days[0].games[1].label, "Nov 21, vs Team Long Island: QAB recorded, 1 QAB in 2 PA. Tracking in progress");

// ---- ordering inside a day
const day = [
  g("z9", "2026-12-01", null, "tD", "Day Test", "Rays", 1, 2),
  g("a1", "2026-12-01", null, "tD", "Day Test", "Angels", 1, 2),
  g("m5", "2026-12-01", null, "tD", "Day Test", "Mustangs", 1, 2),
];
const hd = hist([["z9", 1, 2], ["a1", 1, 2], ["m5", 1, 2]]);
const d1 = R.playerTournamentView(day, hd).dots[0].days[0];
ok("without start times the order inside a day is stable and by opponent, not by position in the list", d1.games.map((x) => x.gameId), ["a1", "m5", "z9"]);
ok("input order does not change it", R.playerTournamentView([...day].reverse(), hd).dots[0].days[0].games.map((x) => x.gameId), ["a1", "m5", "z9"]);
ok("the day is flagged as not time-ordered", d1.timesKnown, false);
ok("labels never carry an ordinal such as 'game 2'", d1.games.every((x) => !/game\s*\d|#\d|first|second|third/i.test(x.label)));
const timed = [
  g("t2", "2026-12-02", "15:00:00", "tE", "Timed", "Zed", 1, 2),
  g("t1", "2026-12-02", "09:00:00", "tE", "Timed", "Yak", 1, 2),
];
const d2 = R.playerTournamentView(timed, hist([["t1", 1, 2], ["t2", 1, 2]])).dots[0].days[0];
ok("with every start time present the day is in time order", [d2.games.map((x) => x.gameId), d2.timesKnown], [["t1", "t2"], true]);
const mixed = [g("m1", "2026-12-03", "09:00:00", "tF", "Mixed", "Zed", 1, 2), g("m2", "2026-12-03", null, "tF", "Mixed", "Abe", 1, 2)];
ok("one missing time makes the whole day unordered", R.playerTournamentView(mixed, hist([["m1", 1, 2], ["m2", 1, 2]])).dots[0].days[0].timesKnown, false);

// ---- empty and degenerate input
const none = R.playerTournamentView(games, []);
ok("no history: every game is no PA, counts are zero, no percentage", [none.gamesWithPa, none.gamesWithQab, none.rows.every((r) => r.qabPct === null), none.dots.flatMap((t) => t.days.flatMap((d) => d.games)).every((x) => x.status === "nopa")], [0, 0, true, true]);
ok("no games: nothing to show", [R.playerTournamentView([], []).rows, R.playerTournamentView([], []).dots], [[], []]);
ok("null inputs are safe", R.playerTournamentView(null, null).rows, []);
ok("opponent missing is not invented", R.playerTournamentView([g("o1", "2026-12-04", null, "tG", "T", null, 1, 2)], hist([["o1", 1, 2]])).dots[0].days[0].games[0].label, "Dec 4: QAB recorded, 1 QAB in 2 PA");

// ---- player row wording: "3 games with a PA" or "No PA recorded", never "0 of 1"
ok("rows with plate appearances say how many games she batted in", P.rows.slice(0, 3).map((r) => R.playerRowSummary(r)), ["2 games with a PA", "2 games with a PA", "1 game with a PA"]);
ok("a tournament with no plate appearances says No PA recorded", R.playerRowSummary(P.rows[3]), "No PA recorded");
ok("no wording of the form 'x of y games'", P.rows.every((r) => !/\bof\b/.test(R.playerRowSummary(r))));

// ---- printed key: no-PA games by date and opponent, in tournament and day order
ok("no-PA games are listed by date and opponent for print", R.noPaGames(P).map((x) => x.text), ["Nov 7, vs Top Gun National", "Nov 21, vs Top Gun Sciara", "Nov 28, vs Scrimmage Stars"]);
ok("the list is grouped by tournament name", R.noPaGames(P).map((x) => x.tournament), ["T25 (Scenic)", "Show Me The Money", "Not in a tournament"]);
ok("a player who batted in every game has no list", R.noPaGames(R.playerTournamentView(games, hist([["g1",1,2],["g2",1,2],["g3",1,2],["g4",1,2],["g5",1,2],["g6",1,2],["g7",1,2],["g8",1,2]]))), []);
ok("a missing opponent is not invented in the list", R.noPaGames(R.playerTournamentView([g("o2", "2026-12-04", null, "tG", "T", null, 1, 2)], [])).map((x) => x.text), ["Dec 4"]);
ok("dots carry the date and opponent as plain fields too", [P.dots[0].days[1].games[0].dayLabel, P.dots[0].days[1].games[0].opponent], ["Nov 7", "Top Gun National"]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
