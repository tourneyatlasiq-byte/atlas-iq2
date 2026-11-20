/**
 * RBI as a QAB reason: the real server actions against a real local database
 * that carries the production plate_appearances constraints. Run via
 * scripts/test-rbi-local.sh. Local fictional data; never touches Supabase.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Module = require("module");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const URL_ = process.env.POSTGREST_URL, DB = process.env.DB_NAME, SECRET = process.env.JWT_SECRET;
if (!URL_ || !DB || !SECRET) { console.error("Run via scripts/test-rbi-local.sh"); process.exit(2); }

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : `\n        ${detail === undefined ? "" : JSON.stringify(detail)}`}`);
}
const section = (t) => console.log(`\n${t}\n`);

const A = "a0000000-0000-0000-0000-000000000001", SEASON_A = "5a000000-0000-0000-0000-000000000001";
const COACH = { id: "10000000-0000-0000-0000-000000000002", role: "coach", org: A, season: SEASON_A };
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function jwtFor(u) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: u.id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
const { createClient } = require("@supabase/supabase-js");
const client = () => createClient("http://localhost:0", "anon-key-not-checked", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${jwtFor(COACH)}` }, fetch: (url, opts) => fetch(String(url).replace("http://localhost:0/rest/v1", URL_), opts) },
});

const STUB = path.join(ROOT, "scripts", "__actions_stubs__");
const stubs = new Map([["next/cache", { revalidatePath() {} }]]);
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const CONTEXT = path.join(ROOT, "lib", "context.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) { if (stubs.has(request)) return `${STUB}/${request}`; return origResolve.call(this, request, parent, ...rest); };
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  let resolved = null; try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => client() };
  if (resolved === CONTEXT) return {
    requireSeasonContext: async () => ({ profile: { role: COACH.role }, organization: { id: COACH.org }, season: { id: COACH.season } }),
    canWrite: (p) => ["owner", "admin", "coach", "manager"].includes(p.role),
  };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const SWC_OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(module, filename);
  const { code } = swc.transformSync(fs.readFileSync(filename, "utf8"), { ...SWC_OPTS, filename });
  module._compile(code, filename);
};
const PA = require(path.join(ROOT, "lib", "actions", "plate-appearances.js"));
const RULES = require(path.join(ROOT, "lib", "qab-rules.js"));

const uuid = () => crypto.randomUUID();
const sql = (q) => execFileSync("psql", ["-At", "-d", DB, "-c", q], { encoding: "utf8" }).trim();
const sqlFail = (q) => { try { execFileSync("psql", ["-At", "-d", DB, "-c", q], { encoding: "utf8", stdio: "pipe" }); return ""; } catch (e) { return String(e.stderr); } };
const PL = (n) => `f0000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
const G = (n) => `9a000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const rec = (o) => PA.recordPlateAppearance({ id: uuid(), gameId: G(1), battingOrder: 1, ...o });
const row = (id) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('r', qab_reasons, 'q', is_qab, 'v', voided_at is not null)), '[]') from plate_appearances where id='${id}'`))[0];
const live = () => JSON.parse(sql(`select json_build_object('pa', count(*), 'qab', count(*) filter (where is_qab)) from plate_appearances where voided_at is null`));
const byReason = () => Object.fromEntries(sql(`select coalesce(r,'(none)') || '=' || n from (select qab_reasons[1] r, count(*) n from plate_appearances where voided_at is null group by 1 order by 1) s`).split("\n").filter(Boolean).map((l) => l.split("=")).map(([k, v]) => [k, Number(v)]));
const histHash = () => sql(`select md5(string_agg(id::text || qab_reasons::text, ',' order by id)) from plate_appearances`);

(async () => {
  section("Before the migration: production's eight-reason rule, with historical data");
  const hist = [
    await rec({ playerId: PL(1), paNumber: 1, reasons: ["hit"] }),
    await rec({ playerId: PL(2), paNumber: 1, reasons: ["situation_success"] }),
    await rec({ playerId: PL(3), paNumber: 1, reasons: ["walk"] }),
    await rec({ playerId: PL(4), paNumber: 1, reasons: [] }),
  ];
  ok("fixture: four historical plate appearances recorded (Hit, Situational success, Walk, non-QAB)", hist.every((r) => r.ok), hist);
  const before = histHash(), beforeTally = live(), beforeReasons = byReason();
  const early = await rec({ playerId: PL(5), paNumber: 1, reasons: ["rbi"] });
  ok("RBI is refused by the database until the migration is applied (this is why it must be applied first)", early.ok === false && /pa_reasons_allowed|check constraint/i.test(early.error ?? "") , early);
  ok("...and nothing was written", live().pa === beforeTally.pa && histHash() === before);

  section("Applying supabase/migrations/20261120213000_qab_rbi_reason.sql");
  execFileSync("psql", ["-q", "-d", DB, "-v", "ON_ERROR_STOP=1", "-f", path.join(ROOT, "supabase/migrations/20261120213000_qab_rbi_reason.sql")], { stdio: "pipe" });
  const def = sql(`select pg_get_constraintdef(oid) from pg_constraint where conname='pa_reasons_allowed'`);
  const dbKeys = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
  ok("the constraint now allows exactly the application's reason keys", JSON.stringify(dbKeys) === JSON.stringify([...RULES.REASON_KEYS].sort()), { dbKeys, app: RULES.REASON_KEYS });
  ok("historical rows are unchanged by the migration", histHash() === before);
  ok("one-reason constraint is still in place", sql(`select count(*) from pg_constraint where conname='pa_one_reason'`) === "1");

  section("Recording RBI");
  const rbiId = uuid();
  let r = await PA.recordPlateAppearance({ id: rbiId, gameId: G(1), playerId: PL(5), paNumber: 1, battingOrder: 5, reasons: ["rbi"] });
  ok("RBI records", r.ok === true, r);
  ok("stored as one primary reason and counted as a QAB", JSON.stringify(row(rbiId)) === JSON.stringify({ r: ["rbi"], q: true, v: false }), row(rbiId));
  ok("adding RBI: QAB +1, PA +1, hit/situational/walk counts unchanged",
    live().qab === beforeTally.qab + 1 && live().pa === beforeTally.pa + 1
    && byReason().hit === beforeReasons.hit && byReason().situation_success === beforeReasons.situation_success && byReason().walk === beforeReasons.walk && byReason().rbi === 1,
    { live: live(), byReason: byReason() });

  section("Reload and retry (no duplicate)");
  const sb = client();
  const { data: reloaded } = await sb.from("plate_appearances").select("id, qab_reasons, is_qab").eq("id", rbiId);
  ok("reload through the data layer returns the RBI at-bat", reloaded?.length === 1 && reloaded[0].qab_reasons[0] === "rbi" && reloaded[0].is_qab === true, reloaded);
  const replay = await PA.recordPlateAppearance({ id: rbiId, gameId: G(1), playerId: PL(5), paNumber: 1, battingOrder: 5, reasons: ["rbi"] });
  ok("replaying the same record (an offline retry) is accepted as already delivered", replay.ok === true && replay.duplicate === true, replay);
  ok("...and there is still exactly one row for the slot", sql(`select count(*) from plate_appearances where game_id='${G(1)}' and player_id='${PL(5)}' and pa_number=1`) === "1");
  const clash = await PA.recordPlateAppearance({ id: uuid(), gameId: G(1), playerId: PL(5), paNumber: 1, battingOrder: 5, reasons: ["rbi"] });
  ok("the same RBI at-bat sent again under a new id (two screens) is recognised as already saved, not doubled", clash.ok === true && clash.equivalent === true && clash.id === rbiId && sql(`select count(*) from plate_appearances where game_id='${G(1)}' and player_id='${PL(5)}' and pa_number=1`) === "1", clash);
  const conflict = await PA.recordPlateAppearance({ id: uuid(), gameId: G(1), playerId: PL(5), paNumber: 1, battingOrder: 5, reasons: ["hit"] });
  ok("a different reason for the same slot is a conflict for the coach to resolve, never a second row", conflict.ok === false && conflict.code === "slot_taken" && conflict.conflict?.reasons?.[0] === "rbi" && sql(`select count(*) from plate_appearances where game_id='${G(1)}' and player_id='${PL(5)}' and pa_number=1`) === "1", conflict);

  section("Editing: the reason is replaced, never added");
  const tally0 = live();
  r = await PA.correctPlateAppearance({ id: rbiId, reasons: ["hit"] });
  ok("RBI to Hit: one reason (hit), QAB total unchanged", r.ok && JSON.stringify(row(rbiId).r) === '["hit"]' && live().qab === tally0.qab && byReason().rbi === undefined, { r, row: row(rbiId) });
  r = await PA.correctPlateAppearance({ id: rbiId, reasons: ["rbi"] });
  ok("Hit to RBI: one reason (rbi), QAB total unchanged", r.ok && JSON.stringify(row(rbiId).r) === '["rbi"]' && live().qab === tally0.qab && byReason().rbi === 1, { r, row: row(rbiId) });
  r = await PA.correctPlateAppearance({ id: rbiId, reasons: ["situation_success"] });
  ok("RBI to Situational success replaces it", r.ok && JSON.stringify(row(rbiId).r) === '["situation_success"]' && live().qab === tally0.qab, { r, row: row(rbiId) });
  await PA.correctPlateAppearance({ id: rbiId, reasons: ["rbi"] });
  r = await PA.correctPlateAppearance({ id: rbiId, reasons: [] });
  ok("RBI to non-QAB: QAB drops by one, PA unchanged, no reason left", r.ok && row(rbiId).q === false && live().qab === tally0.qab - 1 && live().pa === tally0.pa, { r, row: row(rbiId), live: live(), tally0 });
  r = await PA.correctPlateAppearance({ id: rbiId, reasons: ["rbi"] });
  ok("non-QAB to RBI: QAB +1 again, PA unchanged", r.ok && row(rbiId).q === true && live().qab === tally0.qab && live().pa === tally0.pa, { r, live: live() });
  r = await PA.correctPlateAppearance({ id: rbiId, reasons: ["rbi", "hit"] });
  ok("RBI plus Hit together is refused with the one-reason message and nothing changes", r.ok === false && /one primary reason/i.test(r.error ?? "") && JSON.stringify(row(rbiId).r) === '["rbi"]', r);
  r = await rec({ playerId: PL(6), paNumber: 1, reasons: ["rbi", "hit"] });
  ok("recording RBI plus Hit together is refused before anything is written", r.ok === false && /one primary reason/i.test(r.error ?? "") && sql(`select count(*) from plate_appearances where player_id='${PL(6)}'`) === "0", r);
  ok("the database also refuses two reasons, directly", /pa_one_reason/.test(sqlFail(`update plate_appearances set qab_reasons='{rbi,hit}' where id='${rbiId}'`)));
  ok("the database still refuses an unknown reason", /pa_reasons_allowed/.test(sqlFail(`update plate_appearances set qab_reasons='{bogus}' where id='${rbiId}'`)));

  section("Undo and restore");
  r = await PA.voidPlateAppearance({ id: rbiId });
  ok("voiding an RBI at-bat removes it from QAB and PA", r.ok && live().qab === tally0.qab - 1 && live().pa === tally0.pa - 1, { r, live: live() });
  r = await PA.restorePlateAppearance({ id: rbiId });
  ok("restoring brings it back as RBI", r.ok && JSON.stringify(row(rbiId)) === JSON.stringify({ r: ["rbi"], q: true, v: false }), { r, row: row(rbiId) });

  section("Reconciliation in the database's own tournament view");
  const viewRows = Object.fromEntries(sql(`select reason || '=' || sum(occurrences) from qab_reason_tournament group by reason order by 1`).split("\n").filter(Boolean).map((l) => l.split("=")).map(([k, v]) => [k, Number(v)]));
  const viewTotal = Object.values(viewRows).reduce((a, b) => a + b, 0);
  ok("reason counts in qab_reason_tournament total the QAB count", viewTotal === live().qab, { viewRows, qab: live().qab });
  ok("RBI appears in the view without any view change", viewRows.rbi === 1, viewRows);

  section("Historical data untouched by everything above");
  const hrows = JSON.parse(sql(`select json_agg(qab_reasons order by player_id) from plate_appearances where id in (${hist.map((h) => `'${h.id ?? h.row?.id ?? ""}'`).join(",")})`) || "null");
  ok("the Hit, Situational success and Walk rows still hold their original reasons", sql(`select string_agg(qab_reasons::text, ' ' order by player_id) from plate_appearances where game_id='${G(1)}' and player_id in ('${PL(1)}','${PL(2)}','${PL(3)}','${PL(4)}')`) === "{hit} {situation_success} {walk} {}", hrows);

  section("Offline: RBI queued with no connection, then synced (real queue, real actions, local database)");
  {
    const qsrc = fs.readFileSync(path.join(ROOT, "scripts/check-queue-recovery.js"), "utf8");
    const idbSrc = /function makeIndexedDB\(\) \{[\s\S]*?\n\}\n/.exec(qsrc)[0];
    global.indexedDB = new Function(`${idbSrc}; return makeIndexedDB();`)();
    global.window = global;
    const Q = require(path.join(ROOT, "lib", "offline-queue.js"));
    const send = async (e) => e.op === "record" ? PA.recordPlateAppearance(e.payload) : e.op === "correct" ? PA.correctPlateAppearance(e.payload) : PA.voidPlateAppearance(e.payload);
    const offline = async () => { throw new Error("Failed to fetch"); };
    const USER = COACH.id, GAME = G(2);
    const id1 = uuid(), id2 = uuid();
    await Q.enqueue({ userId: USER, op: "record", gameId: GAME, payload: { id: id1, gameId: GAME, playerId: PL(7), paNumber: 1, battingOrder: 7, reasons: ["rbi"] } });
    await Q.enqueue({ userId: USER, op: "record", gameId: GAME, payload: { id: id2, gameId: GAME, playerId: PL(8), paNumber: 1, battingOrder: 8, reasons: ["hit"] } });
    const t0 = live();
    let res = await Q.flushQueue(offline, { gameId: GAME, userId: USER });
    ok("with no connection nothing is sent and both entries stay queued, in order", res.sent === 0 && (await Q.pendingEntries(GAME)).length === 2 && live().pa === t0.pa, res);
    ok("the queued RBI keeps its reason while it waits", (await Q.pendingEntries(GAME))[0].payload.reasons[0] === "rbi");
    res = await Q.flushQueue(send, { gameId: GAME, userId: USER, force: true });
    ok("on reconnect both entries are delivered", res.sent === 2 && (await Q.pendingEntries(GAME)).length === 0, res);
    ok("the RBI was saved as RBI (QAB) and the Hit as Hit, QAB +2, PA +2", JSON.stringify(row(id1)) === JSON.stringify({ r: ["rbi"], q: true, v: false }) && row(id2).r[0] === "hit" && live().qab === t0.qab + 2 && live().pa === t0.pa + 2, { r1: row(id1), r2: row(id2), live: live(), t0 });
    // Reconnect twice (the response was lost): the same entry delivered again.
    await Q.enqueue({ userId: USER, op: "record", gameId: GAME, payload: { id: id1, gameId: GAME, playerId: PL(7), paNumber: 1, battingOrder: 7, reasons: ["rbi"] } });
    res = await Q.flushQueue(send, { gameId: GAME, userId: USER, force: true });
    ok("delivering the same queued RBI a second time (lost response) adds nothing", res.sent === 1 && sql(`select count(*) from plate_appearances where game_id='${GAME}' and player_id='${PL(7)}'`) === "1" && live().qab === t0.qab + 2, res);
    // A queued correction RBI -> non-QAB offline.
    await Q.enqueue({ userId: USER, op: "correct", gameId: GAME, payload: { id: id1, reasons: [] } });
    res = await Q.flushQueue(send, { gameId: GAME, userId: USER, force: true });
    ok("a correction queued offline (RBI to No QAB) syncs: QAB -1, PA unchanged", res.sent === 1 && row(id1).q === false && live().qab === t0.qab + 1 && live().pa === t0.pa + 2, { res, row: row(id1), live: live() });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
