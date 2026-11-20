/**
 * Release 3, RPT-001: the Schedule warning names and links the games to review.
 *
 * The parent schedule shows Committed and Considering tournaments, each
 * labelled, with a legend when anything is tentative. These checks run the
 * real query against an in-memory database and render the real document:
 *
 *   A. tournamentScheduleReport: which tournaments are included, the status
 *      vocabulary that can reach the page, chronological order, games
 *   B. TournamentScheduleReport, rendered: a label on every row, the legend,
 *      tentative wording, the empty state
 *
 * Same harness as check-dues-edit.js: SWC from Next.js compiles on the fly,
 * no network or database.
 */

const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
let passed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}

let db = null;
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/link") return { __esModule: true, default: (p) => require("react").createElement("a", p, p.children) };
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => db };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};


function fakeDb(tables) {
  const asked = [];
  return {
    asked,
    from(table) {
      const filters = [];
      let one = false;
      const run = () => {
        const rows = (tables[table] ?? []).filter((r) => filters.every(([k, op, v]) => (op === "eq" ? r[k] === v : v.includes(r[k]))));
        return { data: one ? rows[0] ?? null : rows, error: null };
      };
      const b = {
        select() { return b; },
        eq(k, v) { filters.push([k, "eq", v]); asked.push({ table, eq: [k, v] }); return b; },
        in(k, v) { filters.push([k, "in", v]); asked.push({ table, in: [k, v] }); return b; },
        maybeSingle() { one = true; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
  };
}


const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() + n * 86400000));
const S = "season-1";
const tournaments = [
  { id: "c-next", season_id: S, name: "Red Clay Classic", decision: "Committed", paid_status: "Deposit Paid", start_date: day(10), end_date: day(11), location: "Columbus, GA", facility: null },
  { id: "k-next", season_id: S, name: "Magnolia Showcase", decision: "Considering", start_date: day(20), end_date: day(22), location: null, facility: null },
];
const games = [
  { id: "g-in", season_id: S, tournament_id: "c-next", game_date: day(10), start_time: "09:00:00", opponent_name: "Bayou Blaze 14U" },
  { id: "g-out1", season_id: S, tournament_id: "c-next", game_date: day(40), start_time: "10:00:00", opponent_name: "Hawks 14U" },
  { id: "g-out2", season_id: S, tournament_id: "k-next", game_date: day(-60), start_time: null, opponent_name: null },
];
const season = { id: S, name: "2026-27", team: { id: "team", name: "Bramblewood 14U Gold", organization: { id: "org", name: "Bramblewood Fastpitch", logo_url: null } } };

(async () => {
  const { tournamentScheduleReport } = require(path.join(ROOT, "lib", "queries", "reports", "tournament-schedule.js"));
  console.log("\nSchedule warning (RPT-001)\n");
  db = fakeDb({ seasons: [season], tournaments, games });

  console.log("A. A coach is told which games, and can open each one");
  const coach = await tournamentScheduleReport(S, { reviewLinks: true });
  const w = coach.warnings[0];
  assertEq("one warning, same title as before", [coach.warnings.length, w.title], [1, "Some games have dates outside their tournament"]);
  assertEq("it names each game: opponent, date and tournament", [w.message.includes("Hawks 14U"), w.message.includes("Red Clay Classic"), w.message.includes("Magnolia Showcase"), w.message.includes("Opponent not recorded")], [true, true, true, true]);
  assertEq("it does not name the game that is inside its dates", w.message.includes("Bayou Blaze"), false);
  assertEq("each game has a Review game link, oldest date first, to its tournament's Games section and that game's form",
    w.links.map((l) => l.href), ["/tournaments?open=k-next&section=games&game=g-out2", "/tournaments?open=c-next&section=games&game=g-out1"]);
  assertEq("link labels name the game", w.links.map((l) => l.label.startsWith("Review game")), [true, true]);
  assertEq("the exclusion rule is unchanged: outside games still are not in the document",
    coach.tournaments.flatMap((t) => t.games.map((g) => g.id)), ["g-in"]);
  assertEq("it still says nothing was changed", /Nothing has been changed/.test(w.message), true);

  console.log("B. Anyone else keeps the generic count, with no names and no links");
  const plain = await tournamentScheduleReport(S);
  const pw = plain.warnings[0];
  assertEq("generic warning, count only", [pw.message.startsWith("2 games have dates outside"), "links" in pw], [true, false]);
  assertEq("no opponent, tournament name or game id leaks into the warning", ["Hawks", "Red Clay", "Magnolia", "g-out"].filter((x) => JSON.stringify(plain.warnings).includes(x)), []);

  console.log("C. Edge cases");
  db = fakeDb({ seasons: [season], tournaments, games: [games[0]] });
  assertEq("no outside games: no warning", (await tournamentScheduleReport(S, { reviewLinks: true })).warnings, []);
  const many = Array.from({ length: 12 }, (_, i) => ({ id: "m" + i, season_id: S, tournament_id: "c-next", game_date: day(50 + i), start_time: null, opponent_name: "Opp " + i }));
  db = fakeDb({ seasons: [season], tournaments, games: many });
  const mw = (await tournamentScheduleReport(S, { reviewLinks: true })).warnings[0];
  assertEq("a long list is capped with a count of the rest, every link still reachable", [mw.links.length, /and 4 more/.test(mw.message)], [8, true]);
  db = fakeDb({ seasons: [season], tournaments, games: [{ ...games[1], id: "weird id/../x" }] });
  assertEq("an unsafe game id produces no link (never a malformed address)", "links" in (await tournamentScheduleReport(S, { reviewLinks: true })).warnings[0] && (await tournamentScheduleReport(S, { reviewLinks: true })).warnings[0].links.length > 0, false);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
