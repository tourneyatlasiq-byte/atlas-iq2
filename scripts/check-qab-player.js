/**
 * Individual player QAB report rules (RPT-002, 2026-11).
 *
 * Pure rules only: the one-player allowlist, scope handling, roster status,
 * and reconciliation with the Performance derivation. No database.
 *
 *   A. Totals equal the Performance row for the same scope (Season, Tournament)
 *   B. Reason counts add up to QAB; game rows add up to the headline
 *   C. Allowlist: one player, no teammates, no scores, results or ids
 *   D. Pickup, inactive, regular status
 *   E. Empty history, player absent from a scope, zero QAB
 *   F. Tournament grouping and the outside-dates note
 *   G. Which tournaments are offered for a player
 *
 * Run:  node scripts/check-qab-player.js
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
const R = require(path.join(ROOT, "lib/qab-player-rules.js"));
const { qabPercent } = require(path.join(ROOT, "lib/qab-rules.js"));
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---- a Performance-shaped season, built the way getSeasonPerformance builds it ---- */
const T1 = { id: "t1", name: "Show Me Classic", start_date: "2026-11-07", end_date: "2026-11-08" };
const T2 = { id: "t2", name: "Bash at the Lake", start_date: "2026-11-14", end_date: "2026-11-15" };
const slot = (playerId, name, qab, pa) => ({ playerId, name, qab, pa, battingOrder: 1 });
const game = (gameId, gameDate, tournamentId, tournament, opponent, lineup, extra = {}) => ({
  gameId, gameDate, startTime: null, tournamentId, tournament, opponent,
  result: "W", runsFor: 9, runsAgainst: 2, // present on the source row, must never reach the report
  lineup, pa: lineup.reduce((n, s) => n + s.pa, 0), qab: lineup.reduce((n, s) => n + s.qab, 0), ...extra,
});
const GAMES = [
  game("g1", "2026-11-07", "t1", T1.name, "Rays", [slot("a", "Ava Lane", 2, 3), slot("d", "Dee Teammate", 1, 3)]),
  game("g2", "2026-11-08", "t1", T1.name, "Stars", [slot("a", "Ava Lane", 1, 4), slot("p", "Pat Pickup", 2, 2)]),
  game("g3", "2026-11-14", "t2", T2.name, "Hawks", [slot("d", "Dee Teammate", 2, 3)]), // Ava did not bat
  game("g4", "2026-11-20", "t2", T2.name, "Owls", [slot("a", "Ava Lane", 3, 3)]),      // linked, dated outside t2
  game("g5", "2026-11-21", null, null, "Friendly Nine", [slot("a", "Ava Lane", 0, 2), slot("i", "Ivy Inactive", 1, 2)]),
];
const hist = (id) => GAMES.map((g) => { const s = g.lineup.find((x) => x.playerId === id); return s ? { ...s, opponent: g.opponent, gameDate: g.gameDate, gameId: g.gameId } : null; }).filter(Boolean).filter((h) => h.pa > 0);
const REASONS = (map) => Object.entries(map).map(([label, count]) => ({ label, count }));
function performance(games) {
  const ids = [...new Set(games.flatMap((g) => g.lineup.map((s) => s.playerId)))];
  const names = { a: "Ava Lane", d: "Dee Teammate", p: "Pat Pickup", i: "Ivy Inactive" };
  const players = ids.map((id) => {
    const h = games.flatMap((g) => { const s = g.lineup.find((x) => x.playerId === id); return s ? [{ ...s, opponent: g.opponent, gameDate: g.gameDate, gameId: g.gameId }] : []; });
    const qab = h.reduce((n, x) => n + x.qab, 0), pa = h.reduce((n, x) => n + x.pa, 0);
    return { playerId: id, name: names[id], qab, pa, qabPct: qabPercent(qab, pa), isActive: id !== "i",
      reasons: qab > 0 ? REASONS(id === "a" ? (qab === 6 ? { "Hard-hit ball": 3, "Walk": 2, "Sacrifice fly": 1 } : { "Hard-hit ball": 2, "Walk": 1 }) : { "Walk": qab }) : [],
      history: h.filter((x) => x.pa > 0) };
  });
  return { team: { qab: 0, pa: 0 }, players, games, reasons: [], reasonsCited: 0 };
}
const SEASON = performance(GAMES);
// Ava's reasons for the season scope must sum to her QAB (6); fix the fixture to that.
SEASON.players.find((p) => p.playerId === "a").reasons = REASONS({ "Hard-hit ball": 3, "Walk": 2, "Sacrifice fly": 1 });
const T1_SCOPE = performance(GAMES.filter((g) => g.tournamentId === "t1"));
T1_SCOPE.players.find((p) => p.playerId === "a").reasons = REASONS({ "Hard-hit ball": 2, "Walk": 1 });
const T2_SCOPE = performance(GAMES.filter((g) => g.tournamentId === "t2"));
T2_SCOPE.players.find((p) => p.playerId === "a").reasons = REASONS({ "Hard-hit ball": 2, "Walk": 1 });

const IDENT = { organization: { name: "Mower Fixtures", logoUrl: null }, team: { name: "16U" }, season: { name: "2026-27" } };
const build = (scoped, playerId, extra = {}) =>
  R.buildQabPlayerReport({ scoped, playerId, name: SEASON.players.find((p) => p.playerId === playerId)?.name ?? "Zed Nobody", status: "active", identity: IDENT, generatedAt: "2026-11-20T12:00:00Z", ...extra });

console.log("\nIndividual player QAB report rules\n");

console.log("A. Totals equal Performance for the same scope");
{
  const perf = SEASON.players.find((p) => p.playerId === "a");
  const r = build(SEASON, "a");
  ok("season: qab, pa, qabPct, games match the Performance row", [r.summary.qab, r.summary.pa, r.summary.qabPct, r.summary.games], [perf.qab, perf.pa, perf.qabPct, perf.history.length]);
  const t1 = T1_SCOPE.players.find((p) => p.playerId === "a");
  const rt = build(T1_SCOPE, "a", { tournament: T1 });
  ok("tournament: matches the Performance row for that tournament", [rt.summary.qab, rt.summary.pa, rt.summary.qabPct, rt.summary.games], [t1.qab, t1.pa, t1.qabPct, t1.history.length]);
  ok("percentage is the real qabPercent of its own counts", r.summary.qabPct, qabPercent(r.summary.qab, r.summary.pa));
}

console.log("B. Everything on the page adds up");
for (const [label, scoped, extra] of [["season", SEASON, {}], ["tournament t1", T1_SCOPE, { tournament: T1 }], ["tournament t2", T2_SCOPE, { tournament: T2 }]]) {
  const r = build(scoped, "a", extra);
  ok(`${label}: reason counts sum to QAB`, r.reasons.reduce((n, x) => n + x.count, 0), r.summary.qab);
  ok(`${label}: game rows sum to the headline QAB and PA`, [r.games.reduce((n, g) => n + g.qab, 0), r.games.reduce((n, g) => n + g.pa, 0)], [r.summary.qab, r.summary.pa]);
  ok(`${label}: groups hold exactly the game rows`, r.groups.reduce((n, g) => n + g.games.length, 0), r.games.length);
}
{
  const r = build(SEASON, "a");
  ok("reason share is of the player's QAB, one decimal", r.reasons.map((x) => x.percent), [50, 33.3, 16.7]);
  ok("a game where the player did not bat is not listed", r.games.some((g) => g.id === "g3"), false);
}

console.log("C. Allowlist: one player, no teammates, no scores");
{
  const text = JSON.stringify(build(SEASON, "a"));
  ok("no teammate names", ["Dee Teammate", "Pat Pickup", "Ivy Inactive"].some((n) => text.includes(n)), false);
  ok("no player id, score, result or lineup keys", /"playerId"|"runsFor"|"runsAgainst"|"result"|"lineup"|"battingOrder"/.test(text), false);
  ok("no team comparison key", /teamQab|teamPct|vsTeam|comparison/i.test(text), false);
  // Expanded scope (2026-11): Season scope carries the team's game dates and opponents so the dots can
  // show games she did not bat in. Dates and opponents only: never a teammate's figures.
  const rep = build(SEASON, "a");
  const dots = rep.tournaments.dots.flatMap((t) => t.days.flatMap((d) => d.games));
  const g3 = dots.find((x) => x.gameId === "g3");
  ok("Season scope lists the team game she did not bat in, by date and opponent", [g3?.status, g3?.dayLabel, g3?.opponent], ["nopa", "Nov 14", "Hawks"]);
  ok("...with her own zero, not the teammate's 2 QAB in 3 PA", [g3?.qab, g3?.pa, /2 QAB in 3 PA/.test(g3?.label ?? "")], [0, 0, false]);
  ok("each dot carries exactly these fields", [...new Set(dots.map((x) => Object.keys(x).sort().join(",")))], ["dayLabel,gameId,label,opponent,pa,qab,status,unfinished"]);
  ok("tournament rows carry exactly these fields", [...new Set(rep.tournaments.rows.map((x) => Object.keys(x).sort().join(",")))], ["firstDate,games,gamesWithPa,gamesWithQab,includesUnfinished,lastDate,name,pa,qab,qabPct,trackingInProgress"]);
  ok("her tournament rows reconcile to her own headline", [rep.tournaments.rows.reduce((n, r) => n + r.qab, 0), rep.tournaments.rows.reduce((n, r) => n + r.pa, 0)], [rep.summary.qab, rep.summary.pa]);
  ok("no tournament id or teammate figure anywhere in the new section", /"tournamentId"|"playerId"|"t1"|"t2"|Dee|"id"/.test(JSON.stringify(rep.tournaments)), false);
  ok("tournament scope has no such section", build(SEASON, "a", { tournament: { id: "t1", name: T1.name, start_date: "2026-11-07", end_date: "2026-11-08" } }).tournaments, null);
  ok("generatedAt and identity pass through", [build(SEASON, "a").team.name, build(SEASON, "a").generatedAt], ["16U", "2026-11-20T12:00:00Z"]);
}

console.log("D. Roster status");
{
  const rows = [{ player_id: "a", team_id: "T", is_active: true }, { player_id: "i", team_id: "T", is_active: false }, { player_id: "d", team_id: "OTHER", is_active: true }];
  ok("active", R.playerRosterStatus(rows, "T", "a"), "active");
  ok("inactive keeps history", R.playerRosterStatus(rows, "T", "i"), "inactive");
  ok("no roster row on this team is a pickup", R.playerRosterStatus(rows, "T", "p"), "pickup");
  ok("a row for another team does not count", R.playerRosterStatus(rows, "T", "d"), "pickup");
  ok("tag wording: quiet, none for active", [R.statusTag("active"), R.statusTag("pickup"), R.statusTag("inactive")], [null, "Pickup player", "Inactive"]);
  const rp = build(SEASON, "p", { status: "pickup" });
  ok("pickup report carries history and the tag", [rp.player.tag, rp.summary.pa, rp.games.length], ["Pickup player", 2, 1]);
  const ri = build(SEASON, "i", { status: "inactive" });
  ok("inactive report carries history and the tag", [ri.player.tag, ri.summary.pa, ri.games.length], ["Inactive", 2, 1]);
}

console.log("E. Empty history");
{
  const r = build(SEASON, "zzz");
  ok("no plate appearances: empty, null percentage, no games", [r.empty, r.summary.pa, r.summary.qab, r.summary.qabPct, r.summary.games, r.games.length, r.reasons.length], [true, 0, 0, null, 0, 0, 0]);
  ok("empty state keeps the name and scope", [r.player.name, r.scope.kind], ["Zed Nobody", "season"]);
  const rt = build(T1_SCOPE, "d", { tournament: T1 });
  ok("a player with PAs in one scope but none in another is empty there", [build(T2_SCOPE, "p", { tournament: T2 }).empty, rt.empty], [true, false]);
  const zero = clone(SEASON); zero.players.find((p) => p.playerId === "a").reasons = [];
  const z = build({ ...zero, players: [{ ...zero.players.find((p) => p.playerId === "a"), qab: 0, qabPct: 0, reasons: [], history: hist("a").map((h) => ({ ...h, qab: 0 })) }] }, "a");
  ok("zero QAB with plate appearances is 0.0%, not empty, no reason section rows", [z.empty, z.summary.qabPct, z.reasons.length], [false, 0, 0]);
}

console.log("F. Grouping and the outside-dates note");
{
  const r = build(SEASON, "a");
  ok("season groups: tournaments in date order, then games not in a tournament", r.groups.map((g) => g.title), [T1.name, T2.name, "Games not in a tournament"]);
  ok("games keep date order inside a group", r.groups[0].games.map((g) => g.id), ["g1", "g2"]);
  const rt = build(T2_SCOPE, "a", { tournament: T2 });
  ok("tournament scope: one group titled by the tournament, scope line carries dates", [rt.groups.length, rt.groups[0].title, rt.scope.kind, rt.scope.tournament.name], [1, T2.name, "tournament", T2.name]);
  ok("a linked game dated outside the tournament is included and noted", [rt.games.map((g) => g.id), rt.notes.map((n) => /dated outside/.test(n.message))], [["g4"], [true]]);
  ok("the game itself is flagged so the printed report can say so; others are not", [rt.games.map((g) => g.outside), build(SEASON, "a").games.some((g) => g.outside)], [[true], false]);
  ok("the outside-dates note links to that game once, as a normal link that remembers the player report and its scope for Back (Release 3)", [rt.notes[0].href, rt.notes[0].linkLabel], ["/tournaments/t2/games/g4/track?from=player-report&player=a&scope=t2", "Review game \u2192"]);
  ok("no note when every game is inside the dates", build(T1_SCOPE, "a", { tournament: T1 }).notes.length, 0);
  ok("season scope does not raise the outside-dates note", r.notes.some((n) => /dated outside/.test(n.message)), false);
}

console.log("G. Tournaments offered, and the print header string");
{
  const rows = [{ game: { tournament_id: "t1" } }, { game: { tournament_id: "t1" } }, { game: { tournament_id: "t2" } }, { game: { tournament_id: null } }, { game: null }];
  ok("distinct tournaments from the player's own rows; games without one add nothing", R.tournamentIdsFromRows(rows), ["t1", "t2"]);
  ok("no rows, no tournaments", R.tournamentIdsFromRows([]), []);
  ok("css string escapes quotes and backslashes and drops line breaks and angle brackets", R.cssString('Ava "A" \\ Lane\n</style>'), 'Ava \\"A\\" \\\\ Lane /style');
  ok("the title is the PDF filename", R.playerReportTitle({ team: "16U", player: "Ava Lane", season: "2026-27" }), "16U - QAB Player Report - Ava Lane - 2026-27");
  ok("tournament scope names the tournament instead of the season", R.playerReportTitle({ team: "16U", player: "Ava Lane", season: "2026-27", tournament: "Show Me Classic" }), "16U - QAB Player Report - Ava Lane - Show Me Classic - 2026-27");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
