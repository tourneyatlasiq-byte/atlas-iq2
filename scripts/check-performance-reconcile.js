/**
 * Performance reconciliation (2026-11): every figure on the Season screen comes
 * from one pass over the same plate-appearance rows, so game totals, season
 * totals, player totals and reason counts must agree.
 *
 * Runs the REAL derivation (lib/queries/performance.js getSeasonPerformance)
 * against an in-memory database with a fictional team, and checks the sums.
 *
 * Why this exists: the hand-written sample used for the visual review showed
 * Season QAB 13 beside games that each read 9 of 9 and a reasons note saying
 * "Counts total 27, not 13". That was a fixture error, not a calculation
 * bug. This check proves the calculation reconciles and gives the screenshot
 * harness a source of figures that cannot drift: PERF_DUMP=path writes the
 * derived payload as JSON.
 *
 * Run:  node scripts/check-performance-reconcile.js
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

/* Fictional team: 9 batters (one batting-order slot each, as in a real lineup), 3 games, 9 plate appearances each (27 total). */
const NAMES = ["Avery Brooks", "Casey Lin", "Devon Reyes", "Emery Shaw", "Finley Park", "Gray Moss", "Harper Quinn", "Indy Vale", "Jordan West"];
const PLAYERS = NAMES.map((full_name, i) => ({ id: `p${i + 1}`, full_name }));
const TOURNAMENT = { id: "t1", name: "Fall Kickoff", start_date: "2026-11-07", end_date: "2026-11-08" };
const GAMES = [
  { id: "g1", tournament_id: "t1", season_id: "s1", game_date: "2026-11-07", start_time: "09:00:00", opponent_name: "Dover Heat", game_type: "Pool play", result: "W", runs_for: 8, runs_against: 3, qab_completed_at: "2026-11-07T14:00:00Z" },
  { id: "g2", tournament_id: "t1", season_id: "s1", game_date: "2026-11-07", start_time: "11:30:00", opponent_name: "Bay Storm", game_type: "Pool play", result: "L", runs_for: 2, runs_against: 5, qab_completed_at: "2026-11-07T17:00:00Z" },
  { id: "g3", tournament_id: "t1", season_id: "s1", game_date: "2026-11-08", start_time: "10:00:00", opponent_name: "Sussex Select", game_type: "Bracket", result: null, runs_for: null, runs_against: null, qab_completed_at: null },
];
// Which of the nine plate appearances in each game were quality at-bats, and why.
const QAB_BY_GAME = {
  g1: { 0: "walk", 1: "hard_hit", 3: "walk", 5: "hard_hit", 7: "walk" },          // 5
  g2: { 1: "walk", 2: "hard_hit", 4: "walk", 8: "hard_hit" },                      // 4
  g3: { 0: "walk", 3: "hard_hit", 4: "walk", 6: "hard_hit" },                      // 4
};
const rows = [];
for (const g of GAMES) {
  for (let i = 0; i < 9; i++) {
    const reason = QAB_BY_GAME[g.id][i];
    rows.push({ id: `${g.id}-${i}`, season_id: "s1", game_id: g.id, player_id: PLAYERS[i].id, batting_order: i + 1, qab_reasons: reason ? [reason] : [], voided_at: null });
  }
}
const db = { games: GAMES, tournaments: [TOURNAMENT], plate_appearances: rows };

function fakeClient() {
  return {
    from(table) {
      const f = [];
      const api = {
        select() { return api; },
        eq(c, v) { f.push(["eq", c, v]); return api; },
        is(c, v) { f.push(["is", c, v]); return api; },
        in(c, v) { f.push(["in", c, v]); return api; },
        order() { return api; },
        rows() {
          return (db[table] ?? []).filter((r) => f.every(([op, c, v]) =>
            op === "eq" ? r[c] === v : op === "is" ? (r[c] ?? null) === v : v.includes(r[c]))).map((r) => {
            if (table !== "plate_appearances") return r;
            const g = db.games.find((x) => x.id === r.game_id);
            return { ...r, is_qab: r.qab_reasons.length > 0, player: PLAYERS.find((p) => p.id === r.player_id), game: { ...g, tournament: TOURNAMENT } };
          });
        },
        then(res, rej) { return Promise.resolve({ data: api.rows(), error: null }).then(res, rej); },
      };
      return api;
    },
  };
}

(async () => {
  console.log("\nPerformance reconciliation\n");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "perf-r-"));
  for (const rel of ["lib/qab-rules.js", "lib/performance-tournament.js", "lib/queries/performance.js"]) {
    const out = path.join(root, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, fs.readFileSync(rel, "utf8").replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, a, s, b) => a + (s.endsWith(".js") ? s : s + ".js") + b));
  }
  fs.mkdirSync(path.join(root, "lib/supabase"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib/supabase/server.js"), "export const createClient = () => globalThis.__perfClient();\n");
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  globalThis.__perfClient = fakeClient;
  const perf = await import(pathToFileURL(path.join(root, "lib/queries/performance.js")).href);
  const s = await perf.getSeasonPerformance("s1");

  const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  assertEq("season totals are 13 QAB of 27 PA (48.1%)", [s.team.qab, s.team.pa, s.team.qabPct], [13, 27, 48.1]);
  assertEq("games: per-game QAB and PA are 5/9, 4/9, 4/9", s.games.map((g) => [g.qab, g.pa]), [[5, 9], [4, 9], [4, 9]]);
  assertEq("games add up to the season (PA and QAB)", [sum(s.games, "pa"), sum(s.games, "qab")], [s.team.pa, s.team.qab]);
  assertEq("players add up to the season (PA and QAB)", [sum(s.players, "pa"), sum(s.players, "qab")], [s.team.pa, s.team.qab]);
  assertEq("reason counts add up to season QAB", sum(s.reasons, "count"), s.team.qab);
  assertEq("reasonsCited equals season QAB under the one-reason rule (so no \"Counts total\" note)", s.reasonsCited, s.team.qab);
  assertEq("every player's reasons add up to that player's QAB", s.players.every((p) => sum(p.reasons, "count") === p.qab), true);
  assertEq("every player's game history adds up to that player's totals", s.players.every((p) => sum(p.history, "pa") === p.pa && sum(p.history, "qab") === p.qab), true);
  assertEq("per-game batting-order slots add up to each game", s.games.every((g) => !g.slots || g.slots.length === 0 || (sum(g.slots, "pa") === g.pa && sum(g.slots, "qab") === g.qab)), true);
  assertEq("reasons shown use approved labels only", s.reasons.map((r) => r.label), ["Hit", "Walk", "HBP", "Hard hit ball", "8+ pitch", "Situational success", "Sac bunt", "Sac fly"]);
  assertEq("record counts W/L from results (a game still being tracked has none yet)", [s.record.w, s.record.l, s.record.played, s.record.total], [1, 1, 2, 3]);
  assertEq("games completed counts the explicit completion mark (2 of 3)", s.gamesCompleted, 2);
  // A voided plate appearance must not leak into any total.
  db.plate_appearances.push({ id: "void1", season_id: "s1", game_id: "g1", player_id: "p1", batting_order: 1, qab_reasons: ["hit"], voided_at: "2026-11-07T15:00:00Z" });
  const s2 = await perf.getSeasonPerformance("s1");
  assertEq("a voided plate appearance changes nothing", [s2.team.qab, s2.team.pa, s2.reasonsCited], [13, 27, 13]);
  db.plate_appearances.pop();
  // Legacy two-reason row (saved before the one-reason rule): season QAB counts it once, reasons count both.
  db.plate_appearances[1].qab_reasons = ["hard_hit", "walk"];
  const s3 = await perf.getSeasonPerformance("s1");
  assertEq("legacy two-reason row: QAB counted once, reasons cited counts both (note is shown)", [s3.team.qab, s3.reasonsCited], [13, 14]);

  if (process.env.PERF_DUMP) { db.plate_appearances[1].qab_reasons = ["hard_hit"]; fs.writeFileSync(process.env.PERF_DUMP, JSON.stringify(await perf.getSeasonPerformance("s1"), null, 1)); }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
