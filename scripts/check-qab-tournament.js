/**
 * RPT-04 — Tournament scope of the QAB Performance report.
 *
 * Runs the REAL derivation (getSeasonPerformance), the real Season payload and
 * the real Tournament payload end to end against an in-memory database, so
 * the scope filter, the reconciliation and the Season-unchanged guarantee are
 * all exercised in behaviour, not by pattern.
 *
 * Fixture: scripts/fixtures/qab-tournament.json is the real TC Veterans
 * Tribute weekend (Armor Elite Mower, 7–8 Nov 2026) with every name replaced:
 * the repository is public. Numbers, dates and times are unchanged. Accepted
 * benchmark: 53 QAB / 108 PA across 5 games, 49.1%.
 *
 * Run:  node scripts/check-qab-tournament.js
 */
const { pathToFileURL } = require("url");
const { execSync } = require("child_process");
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

const FIX = JSON.parse(fs.readFileSync(path.resolve("scripts/fixtures/qab-tournament.json"), "utf8"));

/* ---- In-memory database ------------------------------------------------- */

function makeDb(extra = {}) {
  const db = {
    seasons: [
      { id: "s1", name: "2026-27", team: { name: "Fixture Team", organization: { name: "Fixture Club", logo_url: null } } },
      { id: "s2", name: "2025-26", team: { name: "Fixture Team", organization: { name: "Fixture Club", logo_url: null } } },
    ],
    tournaments: [
      { id: "tA", season_id: "s1", name: "Tournament A", start_date: "2026-11-07", end_date: "2026-11-08" },
      { id: "tB", season_id: "s1", name: "Tournament B", start_date: "2026-10-17", end_date: "2026-10-18" },
      { id: "tC", season_id: "s1", name: "Tournament C (untracked)", start_date: "2026-11-14", end_date: "2026-11-15" },
      { id: "tX", season_id: "s2", name: "Other season", start_date: "2025-11-01", end_date: "2025-11-02" },
    ],
    games: [
      ...FIX.games,
      // Tournament B: one earlier game, with a result, so Season mixes scopes.
      { id: "gB1", tournament_id: "tB", season_id: "s1", game_date: "2026-10-17", start_time: "09:00:00", opponent_name: "Opponent B", game_type: "Pool", result: "W", runs_for: 5, runs_against: 2, qab_completed_at: "2026-10-17T16:00:00Z" },
      // Tournament C: a scheduled game, never tracked.
      { id: "gC1", tournament_id: "tC", season_id: "s1", game_date: "2026-11-14", start_time: "08:00:00", opponent_name: "Opponent C", game_type: "Pool", result: null, runs_for: null, runs_against: null, qab_completed_at: null },
      ...(extra.games ?? []),
    ],
    players: FIX.players,
    plate_appearances: [
      ...FIX.plateAppearances,
      { id: "paB1", season_id: "s1", game_id: "gB1", player_id: "p01", batting_order: 1, qab_reasons: ["walk"], voided_at: null },
      { id: "paB2", season_id: "s1", game_id: "gB1", player_id: "p02", batting_order: 2, qab_reasons: [], voided_at: null },
      { id: "paB3", season_id: "s1", game_id: "gB1", player_id: "p03", batting_order: 3, qab_reasons: ["sac_bunt"], voided_at: null },
      // A voided correction inside Tournament A: must never count.
      { id: "paVoid", season_id: "s1", game_id: "g3", player_id: "p05", batting_order: 1, qab_reasons: [], voided_at: "2026-11-08T01:36:00Z" },
      ...(extra.plate_appearances ?? []),
    ],
  };
  return db;
}

function row(table, r, db) {
  if (table === "plate_appearances") {
    const g = db.games.find((x) => x.id === r.game_id);
    const t = db.tournaments.find((x) => x.id === g?.tournament_id);
    return {
      ...r,
      is_qab: (r.qab_reasons ?? []).length > 0, // generated column in Postgres
      player: db.players.find((p) => p.id === r.player_id) ?? null,
      game: g ? { ...g, tournament: t ? { id: t.id, name: t.name, start_date: t.start_date } : null } : null,
    };
  }
  return r;
}

function fakeClient(db, log) {
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
          log.push({ table, f: f.map((x) => x.slice()) });
          return (db[table] ?? []).filter((r) => f.every(([op, c, v]) =>
            op === "eq" ? r[c] === v : op === "is" ? (r[c] ?? null) === v : v.includes(r[c]))).map((r) => row(table, r, db));
        },
        maybeSingle: async () => ({ data: api.rows()[0] ?? null, error: null }),
        then(res, rej) { return Promise.resolve({ data: api.rows(), error: null }).then(res, rej); },
      };
      return api;
    },
  };
}

/* ---- Module loading: the real files, imports resolved, client faked ----- */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qab-t-"));
let loads = 0;

function copyTree(root, files, clientExpr) {
  for (const [rel, src] of Object.entries(files)) {
    const out = path.join(root, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // Node ESM needs extensions; the app's imports are extensionless.
    fs.writeFileSync(out, src.replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, a, spec, b) => a + (spec.endsWith(".js") ? spec : spec + ".js") + b));
  }
  fs.mkdirSync(path.join(root, "lib/supabase"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib/supabase/server.js"), `export const createClient = () => globalThis.__qabClient();\n`);
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
}

function filesAt(rev) {
  const read = (p) => rev ? execSync(`git show ${rev}:${p}`, { encoding: "utf8" }) : fs.readFileSync(p, "utf8");
  const list = ["lib/qab-rules.js", "lib/schedule-rules.js", "lib/queries/performance.js", "lib/queries/reports/qab-performance.js"];
  if (!rev) list.push("lib/queries/reports/qab-tournament.js");
  return Object.fromEntries(list.map((p) => [p, read(p)]));
}

async function load(rev) {
  const root = path.join(tmpRoot, `t${++loads}`);
  copyTree(root, filesAt(rev));
  const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
  return {
    perf: await imp("lib/queries/performance.js"),
    season: await imp("lib/queries/reports/qab-performance.js"),
    tourn: rev ? null : await imp("lib/queries/reports/qab-tournament.js"),
  };
}

const strip = (r) => { const { generatedAt, ...rest } = r; return rest; };

(async () => {
  console.log("\nRPT-04 Tournament QAB\n");
  const BASE = process.env.QAB_BASE_REV || "4f9a8c6";
  let base = null;
  try { base = await load(BASE); } catch (e) { console.log(`  note  base ${BASE} unavailable (${e.message.split("\n")[0]}); Season-unchanged comparison skipped`); }
  const cur = await load(null);
  const log = [];
  const db = makeDb();
  globalThis.__qabClient = () => fakeClient(db, log);

  /* 1. Season is unchanged — the new code against the accepted Season code. */
  if (base) {
    const oldPerf = await base.perf.getSeasonPerformance("s1");
    const newPerf = await cur.perf.getSeasonPerformance("s1");
    assertEq("Season derivation is identical to the accepted code", newPerf, oldPerf);
    assertEq("Season report payload is identical to the accepted code",
      strip(await cur.season.qabPerformanceReport("s1")), strip(await base.season.qabPerformanceReport("s1")));
  }
  const s = await cur.perf.getSeasonPerformance("s1");
  assertEq("Season still spans every tracked tournament (A + B)", [s.team.qab, s.team.pa, s.team.games], [55, 111, 6]);
  log.length = 0;
  await cur.perf.getSeasonPerformance("s1");
  assertEq("Season scope issues no tournament filter and no games pre-read",
    log.some((q) => q.f.some(([op, c]) => c === "tournament_id" || op === "in")), false);

  /* 2. Tournament A reconciles to the accepted benchmark. */
  const t = await cur.perf.getSeasonPerformance("s1", { tournamentId: "tA" });
  assertEq("Tournament A: 53 QAB / 108 PA / 5 games / 49.1%",
    [t.team.qab, t.team.pa, t.team.games, t.team.qabPct], [53, 108, 5, 49.1]);
  assertEq("Tournament A game totals G1–G5",
    t.games.map((g) => `${g.qab}/${g.pa} ${g.qabPct}`),
    ["10/26 38.5", "6/16 37.5", "15/23 65.2", "13/21 61.9", "9/22 40.9"]);
  assertEq("the voided correction is excluded", t.games[2].pa, 23);
  assertEq("Tournament B is not in Tournament A", t.games.some((g) => g.gameId === "gB1"), false);
  assertEq("record in tournament scope is the tournament's games only", t.record.total, 5);

  const r = await cur.tourn.qabTournamentReport("s1", "tA");
  assertEq("payload summary", r.summary, { qabPct: 49.1, qab: 53, pa: 108, games: 5 });
  assertEq("header: tournament name and dates, season context",
    [r.tournament.name, r.tournament.dates, r.season.name], ["Tournament A", "Nov 7–8, 2026", "2026-27"]);
  assertEq("games are numbered G1–G5 in chronological order with day and time",
    r.games.map((g) => `G${g.number} ${g.day} ${g.time}`),
    ["G1 Sat Nov 7 14:00:00", "G2 Sat Nov 7 18:30:00", "G3 Sat Nov 7 20:00:00", "G4 Sun Nov 8 14:00:00", "G5 Sun Nov 8 15:30:00"]);
  assertEq("no game in scope has a result", r.games.every((g) => g.result === null), true);
  assertEq("reasons", r.reasons.map((x) => `${x.label} ${x.count} ${x.percent}`),
    ["Hit 26 49.1", "Hard hit ball 16 30.2", "Walk 7 13.2", "HBP 2 3.8", "Situational success 2 3.8"]);
  assertEq("reasons cited", r.reasonsCited, 53);

  // Player tournament totals — the validated benchmark (names anonymised).
  const BENCH = {
    p06: [9, 13, 69.2, 5, 4, "2/3 2/2 0/2 3/3 2/3"], p05: [7, 11, 63.6, 5, 4, "1/3 0/1 3/3 2/2 1/2"],
    p04: [7, 12, 58.3, 5, 5, "2/3 2/2 1/2 1/2 1/3"], p01: [6, 11, 54.5, 5, 4, "1/3 0/1 2/3 1/2 2/2"],
    p07: [5, 10, 50, 5, 4, "1/2 0/2 2/2 1/2 1/2"], p09: [4, 8, 50, 4, 3, "– 1/2 2/2 1/2 0/2"],
    p03: [5, 11, 45.5, 5, 4, "2/3 0/2 1/2 1/2 1/2"], p10: [5, 11, 45.5, 5, 4, "1/3 1/2 2/2 1/2 0/2"],
    p02: [4, 11, 36.4, 5, 2, "0/3 0/1 2/3 2/2 0/2"], p08: [1, 10, 10, 5, 1, "0/3 0/1 0/2 0/2 1/2"],
  };
  const nameOf = (id) => FIX.players.find((p) => p.id === id).full_name;
  assertEq("player order (QAB% desc, PA desc, name)", r.players.map((p) => p.name), Object.keys(BENCH).map(nameOf));
  for (const [id, [qab, pa, pctv, games, qg, cells]] of Object.entries(BENCH)) {
    const p = r.players.find((x) => x.name === nameOf(id));
    assertEq(`${nameOf(id)}: totals, G, QAB games, game by game`,
      [p.qab, p.pa, p.qabPct, p.games, p.qabGames, p.byGame.map((c) => (c ? `${c.qab}/${c.pa}` : "–")).join(" ")],
      [qab, pa, pctv, games, qg, cells]);
  }
  assertEq("every player's game cells total her own QAB and PA",
    r.players.every((p) => p.byGame.filter(Boolean).reduce((n, c) => n + c.qab, 0) === p.qab &&
                           p.byGame.filter(Boolean).reduce((n, c) => n + c.pa, 0) === p.pa), true);
  assertEq("game cells per column total that game's QAB/PA",
    r.games.map((g, i) => r.players.reduce((n, p) => n + (p.byGame[i]?.qab ?? 0), 0) + "/" + r.players.reduce((n, p) => n + (p.byGame[i]?.pa ?? 0), 0)),
    r.games.map((g) => `${g.qab}/${g.pa}`));
  assertEq("no date warning when every game is inside the tournament", r.notes, []);

  /* 3. Allowlist: coach-facing, still no key to filter down to one player. */
  assertEq("top-level keys", Object.keys(r).sort(),
    ["games", "generatedAt", "notes", "organization", "players", "reasons", "reasonsCited", "season", "summary", "team", "tournament"]);
  assertEq("player rows carry no playerId, history or recent form",
    r.players.every((p) => !("playerId" in p) && !("history" in p) && !("recentForm" in p)), true);
  assertEq("game rows carry no scores, lineups or tournament ids",
    Object.keys(r.games[0]).sort(), ["day", "id", "number", "opponent", "pa", "qab", "qabPct", "result", "time"]);

  /* 4. Result appears in scope only when a game in scope has one. */
  const rb = await cur.tourn.qabTournamentReport("s1", "tB");
  assertEq("Tournament B carries its own result and totals", [rb.games[0].result, rb.summary.qab, rb.summary.pa], ["W", 2, 3]);

  /* 5. Linked game dated outside the tournament: kept, and the coach told. */
  const db2 = makeDb({
    games: [{ id: "gOut", tournament_id: "tA", season_id: "s1", game_date: "2026-08-16", start_time: null, opponent_name: "Opponent Out", game_type: "Pool", result: null, runs_for: null, runs_against: null, qab_completed_at: null }],
    plate_appearances: [{ id: "paOut", season_id: "s1", game_id: "gOut", player_id: "p01", batting_order: 1, qab_reasons: ["hit"], voided_at: null }],
  });
  globalThis.__qabClient = () => fakeClient(db2, []);
  const ro = await cur.tourn.qabTournamentReport("s1", "tA");
  assertEq("an out-of-range linked game stays in scope (G1, chronological)",
    [ro.summary.games, ro.summary.qab, ro.summary.pa, ro.games[0].opponent, ro.games[0].number], [6, 54, 109, "Opponent Out", 1]);
  assertEq("one restrained, screen-only note names the game and asks for a date review",
    [ro.notes.length, ro.notes[0].action, /G1 \(Sun Aug 16\) is linked to this tournament but dated outside Nov 7–8, 2026/.test(ro.notes[0].message)],
    [1, false, true]);
  globalThis.__qabClient = () => fakeClient(db, []);

  /* 6. Scope, not a search: foreign and unknown ids are "not found". */
  assertEq("a tournament from another season is not found", await cur.tourn.qabTournamentReport("s1", "tX"), null);
  assertEq("an unknown id is not found", await cur.tourn.qabTournamentReport("s1", "nope"), null);
  const rc = await cur.tourn.qabTournamentReport("s1", "tC");
  assertEq("a linked but untracked tournament reports nothing tracked, not zeros",
    [rc.summary.pa, rc.summary.qabPct, rc.games.length, rc.players.length], [0, null, 0, 0]);

  /* 7. Selector: tracked tournaments in this season, most recent first. */
  assertEq("tracked tournaments, newest first, untracked and other seasons excluded",
    await cur.tourn.listTrackedTournaments("s1"),
    [{ id: "tA", name: "Tournament A", dates: "Nov 7–8, 2026" }, { id: "tB", name: "Tournament B", dates: "Oct 17–18, 2026" }]);

  /* 8. Document and page wiring (source checks). */
  const comp = fs.readFileSync("components/reports/QabTournamentReport.js", "utf8");
  const seasonComp = fs.readFileSync("components/reports/QabPerformanceReport.js", "utf8");
  const page = fs.readFileSync("app/reports/qab-performance/page.js", "utf8");
  const css = fs.readFileSync("app/reports/qab-performance/qab.css", "utf8");
  assertEq("Result column only when a game in scope has one",
    [/const showResult = games\.some\(\(g\) => Boolean\(g\.result\)\);/.test(comp), /\{showResult && <th className="qab-c-res">Result<\/th>\}/.test(comp)], [true, true]);
  assertEq("dash means did not bat", [/const cell = \(c\) => \(c \? `\$\{c\.qab\}\/\$\{c\.pa\}` : "–"\);/.test(comp), /A dash means the player did not bat\./.test(comp)], [true, true]);
  assertEq("QAB games column and footer definition", [/QAB games<\/th>/.test(comp), /QAB games counts the games/.test(comp)], [true, true]);
  assertEq("Season component gains only the toolbar control",
    /<ReportToolbar name="QAB Performance" controls=\{scopeControl\} \/>/.test(seasonComp), true);
  assertEq("page reads scope from the address and keeps Season as the default",
    [/searchParams\?\.scope === "tournament"/.test(page), /qabPerformanceReport\(season\.id\)/.test(page)], [true, true]);
  const phone = css.slice(css.indexOf("Tournament scope (RPT-04)"), css.indexOf("Phone-width reasons"));
  assertEq("phone: matrix hidden, cards shown, tiles wrap (auto-fill), screen only",
    [/@media screen and \(max-width: 560px\)/.test(phone), /\.qab-gbg-matrix \{ display: none; \}/.test(phone),
     /grid-template-columns: repeat\(auto-fill, minmax\(42px, 1fr\)\)/.test(phone)], [true, true, true]);
  assertEq("cards are hidden by default, so print always uses the matrix",
    /\.qab-gbg-cards \{ display: none;/.test(phone), true);
  assertEq("RPT-04 adds nothing to the print rules (ST-016 untouched)",
    css.slice(css.indexOf("@media print")).includes("qab-gbg") || css.slice(css.indexOf("@media print")).includes("qab-scope"), false);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
