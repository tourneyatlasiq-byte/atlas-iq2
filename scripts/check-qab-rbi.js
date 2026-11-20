/**
 * RBI as its own QAB reason: one fixture, every reader.
 *
 * Runs the REAL derivation (getSeasonPerformance), the real Season, Tournament
 * and Player report builders end to end against an in-memory database (the
 * accepted Tournament A benchmark: 53 QAB / 108 PA), then changes ONE plate
 * appearance at a time the way a coach would, and shows every number moves
 * exactly as the rules say:
 *
 *   non-QAB  -> RBI    QAB +1, PA unchanged, only the RBI count +1
 *   Hit      -> RBI    QAB unchanged, Hit -1, RBI +1 (a replacement, never an addition)
 *   RBI      -> No QAB QAB -1, PA unchanged, RBI back to zero
 *
 * and that reason counts always sum to the QAB total for the same scope, in
 * the team derivation, the Season report, the Tournament report and the Player
 * report. Names in the fixture are fictional.
 *
 * Run:  node scripts/check-qab-rbi.js
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
  const patch = extra.patchGames ?? {};
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
      ...(extra.tournaments ?? []),
    ],
    games: [
      ...FIX.games.map((g) => ({ ...g, ...(patch[g.id] ?? {}) })),
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
  const list = ["lib/qab-rules.js", "lib/schedule-rules.js", "lib/performance-groups.js", "lib/queries/performance.js", "lib/queries/reports/qab-performance.js",
    "lib/queries/reports/qab-tournament.js", "lib/queries/reports/qab-player.js", "lib/qab-player-rules.js", "lib/game-flow-rules.js"];
  // Performance's tournament selection (2026-11) — imported by queries/performance
  // from that version on; older revisions under comparison don't have it.
  const sel = "lib/performance-tournament.js";
  const has = (p) => { try { execSync(`git cat-file -e ${rev}:${p}`, { stdio: "ignore" }); return true; } catch { return false; } };
  if (rev ? has(sel) : fs.existsSync(sel)) list.push(sel);
  return Object.fromEntries(list.map((p) => [p, read(p)]));
}

async function load(rev) {
  const root = path.join(tmpRoot, `t${++loads}`);
  copyTree(root, filesAt(rev));
  const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
  return {
    perf: await imp("lib/queries/performance.js"),
    season: await imp("lib/queries/reports/qab-performance.js"),
    tourn: await imp("lib/queries/reports/qab-tournament.js"),
    player: await imp("lib/queries/reports/qab-player.js"),
    rules: await imp("lib/qab-rules.js"),
  };
}


const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const countOf = (reasons, key) => (reasons.find((r) => r.key === key) ?? { count: 0 }).count;
const labelCount = (reasons, label) => (reasons.find((r) => r.label === label) ?? { count: 0 }).count;

(async () => {
  console.log("\nRBI as a QAB reason: reconciliation across tracker data and every report\n");
  const cur = await load(null);

  /* Rules: the one list, one primary reason. */
  const R = cur.rules;
  assertEq("RBI is a reason, labelled \"RBI\", and is the last of nine", [R.REASON_KEYS.length, R.REASON_KEYS.at(-1), R.reasonLabel("rbi")], [9, "rbi", "RBI"]);
  assertEq("the eight existing reasons keep their keys and their order", R.REASON_KEYS.slice(0, 8),
    ["hit", "walk", "hbp", "hard_hit", "eight_pitch", "situation_success", "sac_bunt", "sac_fly"]);
  assertEq("RBI alone is valid and counts as a QAB", [R.validateReasons(["rbi"]).ok, R.isQualityAtBat(["rbi"])], [true, true]);
  assertEq("RBI together with Hit is refused (one primary reason)", R.validateReasons(["rbi", "hit"]).ok, false);
  assertEq("a hit that also drove in a run is one QAB under the reason the coach chose, never both",
    [R.tallyPlateAppearances([{ qab_reasons: ["hit"] }, { qab_reasons: ["rbi"] }]).qab, R.tallyPlateAppearances([{ qab_reasons: ["hit"] }, { qab_reasons: ["rbi"] }]).pa], [2, 2]);
  assertEq("QAB percent is QAB over recorded PA (RBI counts in the numerator once)", R.qabPercent(54, 108), 50);

  /* Baseline: the accepted benchmark, untouched. */
  const aGames = new Set(FIX.games.filter((g) => g.tournament_id === "tA").map((g) => g.id));
  const live = FIX.plateAppearances.filter((p) => aGames.has(p.game_id) && !p.voided_at);
  const nonQab = live.find((p) => (p.qab_reasons ?? []).length === 0);
  const hit = live.find((p) => (p.qab_reasons ?? []).length === 1 && p.qab_reasons[0] === "hit");

  async function snapshot(patches) {
    const db = makeDb();
    // makeDb shares the fixture's row objects; copy them so one scenario can never leak into the next.
    db.plate_appearances = db.plate_appearances.map((p) => ({ ...p }));
    for (const [id, reasons] of Object.entries(patches)) db.plate_appearances.find((p) => p.id === id).qab_reasons = reasons;
    globalThis.__qabClient = () => fakeClient(db, []);
    const team = await cur.perf.getSeasonPerformance("s1", { tournamentId: "tA" });
    const season = await cur.season.qabPerformanceReport("s1");
    const tourn = await cur.tourn.qabTournamentReport("s1", "tA");
    // The client is a global; bind it per call so a report read later still sees THIS scenario's data.
    const pl = (id) => { globalThis.__qabClient = () => fakeClient(db, []); return cur.player.qabPlayerReport("s1", id, { tournamentId: "tA" }); };
    return { team, season, tourn, pl, db };
  }

  const base = await snapshot({});
  assertEq("baseline: Tournament A is 53 QAB / 108 PA with no RBI in the mix", [base.team.team.qab, base.team.team.pa, countOf(base.team.reasons, "rbi")], [53, 108, 0]);
  assertEq("baseline: the RBI reason is present at zero in the derivation (zero-count handling) and absent from the printed mix",
    [base.team.reasons.some((r) => r.key === "rbi"), base.tourn.reasons.some((r) => r.label === "RBI")], [true, false]);

  /* 1. non-QAB -> RBI */
  const a = await snapshot({ [nonQab.id]: ["rbi"] });
  assertEq("non-QAB to RBI: QAB 53 -> 54, PA stays 108", [a.team.team.qab, a.team.team.pa], [54, 108]);
  assertEq("...only RBI moves: every other reason count is unchanged",
    a.team.reasons.map((r) => `${r.key}:${r.count}`).join(), base.team.reasons.map((r) => r.key === "rbi" ? "rbi:1" : `${r.key}:${r.count}`).join());
  assertEq("...reason counts sum to the QAB total (derivation)", sum(a.team.reasons.map((r) => r.count)), a.team.team.qab);
  assertEq("...QAB% is QAB / recorded PA", a.team.team.qabPct, Math.round((54 / 108) * 1000) / 10);
  assertEq("tournament report: summary and reason mix reconcile", [a.tourn.summary.qab, a.tourn.summary.pa, a.tourn.reasonsCited, sum(a.tourn.reasons.map((r) => r.count))], [54, 108, 54, 54]);
  const rbiRow = a.tourn.reasons.find((r) => r.label === "RBI");
  assertEq("tournament report: RBI row is 1 of 54 QABs (reason share = RBI-primary QABs / total QABs)", [rbiRow?.count, rbiRow?.percent], [1, Math.round((1 / 54) * 1000) / 10]);
  assertEq("tournament report: Hit, Walk, HBP, Hard hit and Situational success unchanged",
    ["Hit", "Walk", "HBP", "Hard hit ball", "Situational success"].map((l) => labelCount(a.tourn.reasons, l)), ["Hit", "Walk", "HBP", "Hard hit ball", "Situational success"].map((l) => labelCount(base.tourn.reasons, l)));
  assertEq("season report: QAB +1 and reasons cited +1 against the same-season baseline",
    [a.season.summary.qab - base.season.summary.qab, a.season.summary.pa - base.season.summary.pa, a.season.reasonsCited - base.season.reasonsCited], [1, 0, 1]);
  assertEq("season report: reason counts sum to its QAB total", sum(a.season.reasons.map((r) => r.count)), a.season.summary.qab);
  assertEq("season report: RBI is listed once, with count 1", a.season.reasons.filter((r) => r.label === "RBI").map((r) => r.count), [1]);

  const owner = nonQab.player_id;
  const pBase = await base.pl(owner), pA = await a.pl(owner);
  assertEq("player report: this player's QAB +1, PA unchanged", [pA.report.summary.qab - pBase.report.summary.qab, pA.report.summary.pa - pBase.report.summary.pa], [1, 0]);
  const prb = (pA.report.reasons ?? []).find((r) => r.label === "RBI");
  assertEq("player report: RBI appears with count 1 and the player's reasons sum to their QAB", [prb?.count, sum((pA.report.reasons ?? []).map((r) => r.count))], [1, pA.report.summary.qab]);
  const other = FIX.players.find((p) => p.id !== owner && (base.team.players.find((x) => x.playerId === p.id)?.pa ?? 0) > 0).id;
  const oBase = await base.pl(other), oA = await a.pl(other);
  assertEq("player report: a different player is untouched", [oA.report.summary.qab, oA.report.summary.pa], [oBase.report.summary.qab, oBase.report.summary.pa]);
  assertEq("player and team figures agree: the team's players add up to the team QAB",
    sum(a.team.players.map((p) => p.qab)), a.team.team.qab);

  /* 2. Hit -> RBI (replacement) */
  const b = await snapshot({ [nonQab.id]: ["rbi"], [hit.id]: ["rbi"] });
  assertEq("Hit to RBI: QAB unchanged (54), Hit 26 -> 25, RBI 1 -> 2", [b.team.team.qab, countOf(b.team.reasons, "hit"), countOf(b.team.reasons, "rbi")], [54, 25, 2]);
  assertEq("...reasons still sum to QAB, and the tournament report shows the same",
    [sum(b.team.reasons.map((r) => r.count)), sum(b.tourn.reasons.map((r) => r.count)), labelCount(b.tourn.reasons, "RBI")], [54, 54, 2]);

  /* 3. RBI -> No QAB */
  const c = await snapshot({ [nonQab.id]: [], [hit.id]: ["rbi"] });
  assertEq("RBI to No QAB: QAB 54 -> 53, PA unchanged, RBI 2 -> 1", [c.team.team.qab, c.team.team.pa, countOf(c.team.reasons, "rbi")], [53, 108, 1]);
  assertEq("...and everything reconciles", [sum(c.team.reasons.map((r) => r.count)), c.tourn.summary.qab, sum(c.tourn.reasons.map((r) => r.count))], [53, 53, 53]);

  /* Optional: write the payloads of a mixed-reason scenario for the phone and print previews. */
  if (process.env.RBI_DUMP) {
    const hits = live.filter((p) => (p.qab_reasons ?? [])[0] === "hit").slice(0, 3).map((p) => p.id);
    const mixed = await snapshot({ [nonQab.id]: ["rbi"], ...Object.fromEntries(hits.map((id) => [id, ["rbi"]])) });
    const dir = process.env.RBI_DUMP; fs.mkdirSync(dir, { recursive: true });
    const hitOwner = live.find((p) => p.id === hits[0]).player_id;
    fs.writeFileSync(path.join(dir, "tournament.json"), JSON.stringify(mixed.tourn));
    fs.writeFileSync(path.join(dir, "season.json"), JSON.stringify(mixed.season));
    fs.writeFileSync(path.join(dir, "player.json"), JSON.stringify((await mixed.pl(hitOwner)).report));
    fs.writeFileSync(path.join(dir, "scenario.json"), JSON.stringify({ rbiPlayerIds: [owner, hitOwner], teamRbi: countOf(mixed.team.reasons, "rbi"), qab: mixed.team.team.qab, pa: mixed.team.team.pa }));
  }

  /* Untracked and zero handling still hold with RBI in the list. */
  const none = await cur.tourn.qabTournamentReport("s1", "tC");
  assertEq("an untracked tournament still produces a report with no reasons (no RBI row, no error)", [none?.summary?.qab ?? 0, (none?.reasons ?? []).length], [0, 0]);

  /* Historical data: a legacy record is read exactly as before. */
  const legacy = await snapshot({});
  assertEq("historical Hit and Situational success records are not relabelled as RBI", [countOf(legacy.team.reasons, "hit"), countOf(legacy.team.reasons, "situation_success"), countOf(legacy.team.reasons, "rbi")], [26, 2, 0]);

  /* One list, and the database rule that mirrors it. */
  const read = (f) => fs.readFileSync(f, "utf8");
  const migration = read("supabase/migrations/20261120213000_qab_rbi_reason.sql");
  const sqlCode = migration.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const sqlKeys = [...sqlCode.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assertEq("the RBI migration allows exactly the application's reason keys", sqlKeys, [...R.REASON_KEYS].sort());
  assertEq("the RBI migration changes only pa_reasons_allowed (no data statements, no other constraint)",
    [/\b(insert|update|delete|truncate)\b/i.test(sqlCode), /drop table|drop column/i.test(sqlCode), (sqlCode.match(/constraint\s+(\w+)/gi) ?? []).map((x) => x.split(/\s+/)[1]).sort()],
    [false, false, ["pa_reasons_allowed", "pa_reasons_allowed"]]);
  assertEq("the existing one-reason rule is not touched by the RBI migration", /pa_one_reason/.test(sqlCode), false);
  const listLeaks = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, f.name);
    if (f.isDirectory()) { if (!["node_modules", ".next"].includes(f.name)) walk(full); }
    else if (/\.(js|jsx)$/.test(f.name) && full !== path.join("lib", "qab-rules.js") && /["'](eight_pitch|situation_success|sac_bunt)["']/.test(read(full))) listLeaks.push(full);
  } };
  ["app", "components", "lib"].forEach(walk);
  assertEq("no second hardcoded reason list anywhere in app, components or lib", listLeaks, []);
  const tracker = read("components/TrackerClient.js");
  assertEq("the live tracker and the correction panel both draw their tiles from the one list",
    (tracker.match(/QAB_REASONS\.map\(/g) ?? []).length, 2);

  /* Offline queue: queued RBI entries are read, de-duplicated and kept apart from other reasons. */
  const qrDir = path.join(tmpRoot, "qr"); fs.mkdirSync(path.join(qrDir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(qrDir, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(qrDir, "lib/queue-recovery.js"), read("lib/queue-recovery.js"));
  const QR = await import(pathToFileURL(path.join(qrDir, "lib/queue-recovery.js")).href);
  const GID = "a0000000-0000-0000-0000-0000000000a1", PID = "f0000000-0000-0000-0000-000000000105";
  const queued = (reasons, extra = {}) => ({ seq: 1, op: "record", gameId: GID, attempts: 3, lastError: "That batter already has a plate appearance in this slot.", queuedAt: 1,
    payload: { id: "11111111-1111-4111-8111-111111111111", gameId: GID, playerId: PID, paNumber: 1, battingOrder: 5, reasons, ...extra } });
  const savedRow = (reasons) => ({ id: "22222222-2222-4222-8222-222222222222", player_id: PID, pa_number: 1, batting_order: 5, qab_reasons: reasons, voided_at: null, notes: null });
  assertEq("a queued RBI whose slot already holds the same RBI is resolved as already saved (a retry never duplicates)",
    QR.safeResolutions([queued(["rbi"])], [savedRow(["rbi"])]), [{ seqs: [1], reason: "already_saved" }]);
  assertEq("a queued RBI against a saved Hit is NOT dropped: it stays for the coach (a different reason is a real conflict)",
    QR.safeResolutions([queued(["rbi"])], [savedRow(["hit"])]), []);
  assertEq("a queued Hit against a saved RBI is likewise kept for the coach",
    QR.safeResolutions([queued(["hit"])], [savedRow(["rbi"])]), []);
  assertEq("an entry queued before RBI existed (Hit) is still read and resolved exactly as before",
    QR.safeResolutions([queued(["hit"])], [savedRow(["hit"])]), [{ seqs: [1], reason: "already_saved" }]);
  assertEq("queued RBI is a retryable record like any other (not classed permanent)", QR.classifyAttempt({ ok: false, code: "network" }).kind, "transient");

  console.log(`\n${ran} assertions, ${failures} failed`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
