/**
 * The real lineup actions and tracker cursor, run against a real local database.
 *
 *   action (lib/actions/*.js)  ->  @supabase/supabase-js  ->  local REST shim
 *     ->  row security + triggers  ->  the pending migration's functions
 *
 * Only the framework edges are stood in: next/cache, the session/context lookup
 * (which user and organization is "signed in") and how the client is built
 * (a real supabase-js client, signed in with a real signed JWT).
 *
 * Run via scripts/test-actions-local.sh (it builds the database and starts
 * the shim). Local fixture only; never touches Supabase.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Module = require("module");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const URL_ = process.env.POSTGREST_URL;
const DB = process.env.DB_NAME;
const SECRET = process.env.JWT_SECRET;
if (!URL_ || !DB || !SECRET) { console.error("Run via scripts/test-actions-local.sh"); process.exit(2); }

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : `\n        ${detail === undefined ? "" : JSON.stringify(detail)}`}`);
}
const section = (t) => console.log(`\n${t}\n`);

/* ---- identities (same ids as actions-seed.sql) ---- */
const A = "a0000000-0000-0000-0000-000000000001", B = "b0000000-0000-0000-0000-000000000001";
const SEASON_A = "5a000000-0000-0000-0000-000000000001", SEASON_B = "5b000000-0000-0000-0000-000000000001";
const USERS = {
  owner:  { id: "10000000-0000-0000-0000-000000000001", role: "owner",  org: A, season: SEASON_A },
  coach:  { id: "10000000-0000-0000-0000-000000000002", role: "coach",  org: A, season: SEASON_A },
  parent: { id: "10000000-0000-0000-0000-000000000003", role: "parent", org: A, season: SEASON_A },
  coachB: { id: "10000000-0000-0000-0000-000000000004", role: "coach",  org: B, season: SEASON_B },
};

function b64(o) { return Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url"); }
function jwtFor(u) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: u.id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

let current = USERS.owner;
const { createClient } = require("@supabase/supabase-js");
function clientFor(u) {
  return createClient("http://localhost:0", "anon-key-not-checked", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${jwtFor(u)}` },
      // supabase-js addresses /rest/v1/*; the shim serves the same paths at /*.
      fetch: (url, opts) => fetch(String(url).replace("http://localhost:0/rest/v1", URL_), opts),
    },
  });
}

/* ---- module loading: stand in only for the framework edges ---- */
const STUB = path.join(ROOT, "scripts", "__actions_stubs__");
const stubs = new Map([["next/cache", { revalidatePath() {} }]]);
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const CONTEXT = path.join(ROOT, "lib", "context.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (stubs.has(request)) return `${STUB}/${request}`;
  return origResolve.call(this, request, parent, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  let resolved = null; try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => clientFor(current) };
  if (resolved === CONTEXT) {
    return {
      requireSeasonContext: async () => ({
        profile: { role: current.role }, organization: { id: current.org }, season: { id: current.season },
      }),
      canWrite: (p) => ["owner", "admin", "coach", "manager"].includes(p.role),
    };
  }
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
const L = require(path.join(ROOT, "lib", "actions", "lineup.js"));
const { resumePosition, sequenceAudit } = require(path.join(ROOT, "lib", "tracker-cursor.js"));

/* ---- helpers ---- */
const uuid = () => crypto.randomUUID();
const sql = (q) => execFileSync("psql", ["-At", "-d", DB, "-c", q], { encoding: "utf8" }).trim();
const as = (u) => { current = USERS[u]; };
const PL = (n) => `f0000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`; // p01..p12
const PB = "f0000000-0000-0000-0000-0000000001b1";
const G = (n) => `9a000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const GB = "9b000000-0000-0000-0000-000000000001";
const NAME = Object.fromEntries([...Array(12)].map((_, i) => [PL(i + 1), `p${String(i + 1).padStart(2, "0")}`]));
const slots = (g) => sql(`select coalesce(string_agg(batting_order || ':' || right(player_id::text, 3), ' ' order by batting_order), '') from game_lineup_slots where game_id='${g}'`);
const lineupOf = (g) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('batting_order', batting_order, 'player_id', player_id) order by batting_order), '[]') from game_lineup_slots where game_id='${g}'`));
const names = (g) => lineupOf(g).map((s) => NAME[s.player_id] ?? s.player_id.slice(-4)).join(" ");
const ids = (...ns) => ns.map(PL);
const count = (g) => Number(sql(`select count(*) from game_lineup_slots where game_id='${g}'`));
const paRows = (g) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('player_id', player_id, 'batting_order', batting_order, 'pa_number', pa_number, 'created_at', created_at, 'voided_at', voided_at) order by created_at), '[]') from plate_appearances where game_id='${g}'`));
let clock = 0;
const addPa = (g, playerNo, slot, paNo) => sql(`insert into plate_appearances (organization_id, season_id, game_id, player_id, pa_number, batting_order, created_at) values ('${A}','${SEASON_A}','${g}','${PL(playerNo)}',${paNo},${slot}, timestamptz '2026-11-01 12:00:00+00' + interval '${++clock} seconds')`);

(async () => {
  let r;

  /* ===================== saveLineup ===================== */
  section("saveLineup: numbering, validation, roles, feature gate, finished seasons");
  as("coach");
  r = await L.saveLineup(G(1), ids(3, 1, 2));
  ok("saves in the order given, numbered 1..3 with no gaps", r.ok === true && names(G(1)) === "p03 p01 p02" && slots(G(1)).startsWith("1:103 2:101 3:102"), { r, s: slots(G(1)) });
  r = await L.saveLineup(G(1), ids(2, 3, 1, 4));
  ok("saving again replaces the whole order", r.ok === true && names(G(1)) === "p02 p03 p01 p04", r);
  r = await L.saveLineup(G(1), ids(1, 1, 2));
  ok("a player twice in one order is refused", r.ok === false && /twice/.test(r.error), r);
  ok("...and the saved lineup is untouched by the refusal", names(G(1)) === "p02 p03 p01 p04");
  r = await L.saveLineup(G(1), [...ids(1, 2), PB]);
  ok("a player from another organization is refused", r.ok === false && /isn't on this team/.test(r.error), r);
  ok("...and the lineup is untouched (validated before the delete)", names(G(1)) === "p02 p03 p01 p04");
  r = await L.saveLineup(G(1), [PL(11)]);
  ok("an archived player is refused", r.ok === false, r);
  r = await L.saveLineup(G(1), [PL(12)]);
  ok("a coach or staff row is refused", r.ok === false, r);
  r = await L.saveLineup(G(1), [uuid()]);
  ok("a made-up id is refused", r.ok === false, r);
  r = await L.saveLineup(G(1), ids(1, 2, 10));
  ok("a tournament pickup who is not on the season roster is accepted", r.ok === true && names(G(1)) === "p01 p02 p10", r);
  const forty = [...Array(40)].map((_, i) => PL((i % 9) + 1));
  r = await L.saveLineup(G(1), ids(1, 2, 3, 4, 5, 6, 7, 8, 9));
  ok("nine batters save", r.ok === true && count(G(1)) === 9, r);
  r = await L.saveLineup(G(1), []);
  ok("CLEARING: saving an empty order clears an existing lineup", r.ok === true && count(G(1)) === 0 && /cleared/i.test(r.notice), r);
  r = await L.saveLineup(G(1), null);
  ok("a missing order is treated as empty, not a crash", r.ok === true, r);
  r = await L.saveLineup("", ids(1));
  ok("a missing game is refused", r.ok === false, r);
  r = await L.saveLineup(uuid(), ids(1));
  ok("an unknown game is refused", r.ok === false && /could not be found/.test(r.error), r);

  as("parent");
  r = await L.saveLineup(G(2), ids(1, 2));
  ok("a parent cannot save a lineup", r.ok === false && count(G(2)) === 0, r);
  as("coachB");
  r = await L.saveLineup(G(2), ids(1, 2));
  ok("a coach from another organization cannot touch this game", r.ok === false && count(G(2)) === 0, r);
  r = await L.saveLineup(GB, [PB]);
  ok("UNAVAILABLE: an organization without QAB gets a plain 'aren't available' message", r.ok === false && /aren't available for this organization/.test(r.error), r);
  ok("...and nothing is written", count(GB) === 0);
  as("coach");
  sql(`update seasons set phase='past' where id='${SEASON_A}'`);
  r = await L.saveLineup(G(3), ids(1, 2));
  ok("a coach cannot write a lineup in a finished season", r.ok === false && count(G(3)) === 0, r);
  as("owner");
  sql(`update seasons set phase='current' where id='${SEASON_A}'`);
  as("coach");

  /* ===================== atomic Save and Copy ===================== */
  section("saveLineup and copyLineupFrom are atomic: a failure keeps the previous lineup");
  as("coach");
  await L.saveLineup(G(4), ids(1, 2, 3, 4, 5));
  sql(`create function test_block_player() returns trigger language plpgsql as $$ begin if new.player_id = '${PL(9)}' then raise exception 'simulated database failure'; end if; return new; end $$`);
  sql(`create trigger test_block before insert on game_lineup_slots for each row execute function test_block_player()`);
  r = await L.saveLineup(G(4), ids(6, 7, 9));
  ok("when the write fails the save reports an error", r.ok === false, r);
  ok("the previous 5-batter lineup is still there", count(G(4)) === 5 && names(G(4)) === "p01 p02 p03 p04 p05", { n: names(G(4)) });
  sql(`drop trigger test_block on game_lineup_slots`);
  await L.saveLineup(G(6), ids(1, 2, 3, 4, 5));
  await L.saveLineup(G(7), ids(1, 2, 3));
  sql(`update game_lineup_slots set player_id='${PL(9)}' where game_id='${G(7)}' and batting_order=2`); // source now holds the poisoned player
  sql(`create trigger test_block before insert on game_lineup_slots for each row execute function test_block_player()`);
  r = await L.copyLineupFrom(G(6), G(7), { replace: true });
  ok("copy with replace: a failed write reports an error", r.ok === false, r);
  ok("...and the destination keeps its 5-batter lineup", names(G(6)) === "p01 p02 p03 p04 p05", { n: names(G(6)) });
  sql(`drop trigger test_block on game_lineup_slots`);
  sql(`drop function test_block_player()`);
  for (const g of [4, 6, 7]) sql(`delete from game_lineup_slots where game_id='${g === 4 ? G(4) : g === 6 ? G(6) : G(7)}'`);

  await L.saveLineup(G(3), ids(1, 2, 3));
  sql(`update seasons set phase='past' where id='${SEASON_A}'`);
  as("owner");
  r = await L.saveLineup(G(3), ids(3, 2, 1));
  ok("a finished season refuses the save, even for an owner, and says so", r.ok === false && /season has finished/.test(r.error), r);
  ok("...and the finished game's lineup is intact (it used to be deleted)", names(G(3)) === "p01 p02 p03", { n: names(G(3)) });
  sql(`update seasons set phase='current' where id='${SEASON_A}'`);
  as("coach");
  sql(`delete from game_lineup_slots where game_id='${G(3)}'`);

  /* ===================== copyLineupFrom ===================== */
  section("copyLineupFrom: explicit source, replace confirmation, archived players, scope");
  as("coach");
  await L.saveLineup(G(1), ids(1, 2, 3, 4, 5, 6));
  r = await L.copyLineupFrom(G(2), G(1), {});
  ok("copies into an empty game, renumbered 1..6, and the source is untouched", r.ok === true && r.copied === 6 && names(G(2)) === "p01 p02 p03 p04 p05 p06" && names(G(1)) === "p01 p02 p03 p04 p05 p06", r);
  await L.saveLineup(G(3), ids(7, 8));
  r = await L.copyLineupFrom(G(3), G(1), {});
  ok("copying over an existing lineup asks first (needsConfirm), and writes nothing", r.ok === false && r.needsConfirm === true && r.existing === 2 && names(G(3)) === "p07 p08", r);
  r = await L.copyLineupFrom(G(3), G(1), { replace: true });
  ok("with replace it overwrites", r.ok === true && names(G(3)) === "p01 p02 p03 p04 p05 p06", r);
  sql(`update game_lineup_slots set player_id='${PL(11)}' where game_id='${G(1)}' and batting_order=3`); // archived player now at slot 3 of the source
  r = await L.copyLineupFrom(G(4), G(1), {});
  ok("an archived player is skipped and the rest renumbered with no gap", r.ok === true && r.copied === 5 && /1 archived player was skipped/.test(r.notice) && slots(G(4)) === "1:101 2:102 3:104 4:105 5:106", { r, s: slots(G(4)) });
  r = await L.copyLineupFrom(G(2), G(2), {});
  ok("the same game as source is refused", r.ok === false && /same game/.test(r.error), r);
  r = await L.copyLineupFrom(G(5), uuid(), {});
  ok("an unknown source game is refused", r.ok === false, r);
  r = await L.copyLineupFrom(G(5), G(8), {});
  ok("a source with no lineup is refused with a clear message", r.ok === false && /no active players/.test(r.error), r);
  r = await L.copyLineupFrom(G(5), "", {});
  ok("no source chosen is refused", r.ok === false && /Choose a game/.test(r.error), r);
  as("coachB");
  r = await L.copyLineupFrom(GB, G(1), {});
  ok("a coach from another organization cannot copy another organization's lineup", r.ok === false, r);
  as("parent");
  r = await L.copyLineupFrom(G(5), G(1), {});
  ok("a parent cannot copy", r.ok === false && count(G(5)) === 0, r);
  as("coach");
  addPa(G(1), 1, 1, 1);
  await L.copyLineupFrom(G(6), G(1), {});
  ok("plate appearances are never copied", Number(sql(`select count(*) from plate_appearances where game_id='${G(6)}'`)) === 0);
  sql(`delete from plate_appearances`);
  for (const g of [1, 2, 3, 4, 6]) sql(`delete from game_lineup_slots where game_id='${G(g)}'`);

  /* ===================== substitutePlayer ===================== */
  section("substitutePlayer: one slot changes, recorded at-bats stay with who batted");
  const G9 = G(9);
  await L.saveLineup(G9, ids(1, 2, 3, 4, 5, 6, 7, 8, 9));
  addPa(G9, 1, 1, 1); addPa(G9, 2, 2, 1); addPa(G9, 3, 3, 1); addPa(G9, 4, 4, 1);
  const before = JSON.stringify(paRows(G9));
  r = await L.substitutePlayer(G9, 4, PL(10));
  ok("a pickup comes in for slot 4; only that slot changes", r.ok === true && names(G9) === "p01 p02 p03 p10 p05 p06 p07 p08 p09", { r, n: names(G9) });
  ok("the starter's recorded at-bat is untouched (still p04, still slot 4)", JSON.stringify(paRows(G9)) === before);
  const nextAfterSub = resumePosition(lineupOf(G9), paRows(G9));
  ok("the cursor still points at slot 5 after the substitution", nextAfterSub.index === 4 && nextAfterSub.reason === "derived", nextAfterSub);
  ok("the sequence audit is clean after a substitution", sequenceAudit(lineupOf(G9), paRows(G9)).violations.length === 0);
  r = await L.substitutePlayer(G9, 4, PL(10));
  ok("subbing in the player who is already there is refused", r.ok === false, r);
  r = await L.substitutePlayer(G9, 5, PL(1));
  ok("a player already batting elsewhere is refused and told where", r.ok === false && /position 1/.test(r.error), r);
  r = await L.substitutePlayer(G9, 5, PB);
  ok("a player from another organization is refused", r.ok === false, r);
  r = await L.substitutePlayer(G9, 5, PL(11));
  ok("an archived player is refused", r.ok === false, r);
  r = await L.substitutePlayer(G9, 12, PL(7));
  ok("a position not in the lineup is refused", r.ok === false && /isn't in this lineup/.test(r.error), r);
  r = await L.substitutePlayer(G9, 0, PL(7));
  ok("position 0 is refused", r.ok === false, r);
  as("parent");
  r = await L.substitutePlayer(G9, 5, PL(12));
  ok("a parent cannot substitute", r.ok === false && names(G9).includes("p05"), r);
  as("coachB");
  r = await L.substitutePlayer(G9, 5, PB);
  ok("a coach from another organization cannot", r.ok === false && names(G9).includes("p05"), r);
  as("coach");

  /* ===================== tracked game: the order is fixed ===================== */
  section("TRACKED GAME: reorders that used to be accepted are now refused, and nothing moves");
  console.log("  Same fixture as the reproduction: nine batters p01..p09, at-bats recorded for p01..p04 in order.\n");
  const original = ids(1, 2, 3, 4, 5, 6, 7, 8, 9);
  const reset9 = async () => {
    sql(`delete from plate_appearances where game_id='${G9}'`);
    sql(`delete from game_lineup_slots where game_id='${G9}'`);
    await L.saveLineup(G9, original);
    addPa(G9, 1, 1, 1); addPa(G9, 2, 2, 1); addPa(G9, 3, 3, 1); addPa(G9, 4, 4, 1);
  };
  const scenarios = [
    ["A. Swap two batters (p03 and p07)", ids(1, 2, 7, 4, 5, 6, 3, 8, 9)],
    ["B. Move the leadoff p01 to the bottom", ids(2, 3, 4, 5, 6, 7, 8, 9, 1)],
    ["C. Drop a batter who already batted (p02)", ids(1, 3, 4, 5, 6, 7, 8, 9)],
    ["D. Add a late arrival at the TOP (p10)", ids(10, 1, 2, 3, 4, 5, 6, 7, 8, 9)],
    ["E. Shorten the order to 3 batters", ids(1, 2, 3)],
    ["F. Clear the lineup", []],
    ["G. Change a player in a slot through Save (p04 -> p10)", ids(1, 2, 3, 10, 5, 6, 7, 8, 9)],
  ];
  const keep = "p01 p02 p03 p04 p05 p06 p07 p08 p09";
  for (const [label, newOrder] of scenarios) {
    await reset9();
    r = await L.saveLineup(G9, newOrder);
    const cur = resumePosition(lineupOf(G9), paRows(G9));
    console.log(`  ${label}\n    save: refused, "${r.error}"`);
    ok(`${label}: refused`, r.ok === false && /already being tracked/.test(r.error), r);
    ok(`${label}: order unchanged and the tracker still resumes at p05`, names(G9) === keep && cur.index === 4, { n: names(G9), cur });
    ok(`${label}: the 4 recorded at-bats are untouched`, paRows(G9).length === 4);
  }
  console.log("");

  // The same changes attempted as direct table writes (a stale tab, a crafted request), bypassing the action.
  section("TRACKED GAME: direct table writes are refused by the database too");
  await reset9();
  const sb = clientFor(current);
  let w = await sb.from("game_lineup_slots").delete().eq("game_id", G9);
  ok("deleting every slot directly is refused", !!w.error && count(G9) === 9, w.error);
  w = await sb.from("game_lineup_slots").delete().eq("game_id", G9).eq("batting_order", 2);
  ok("deleting one slot directly is refused", !!w.error && count(G9) === 9, w.error);
  w = await sb.from("game_lineup_slots").update({ batting_order: 20 }).eq("game_id", G9).eq("batting_order", 2);
  ok("renumbering a slot directly is refused", !!w.error && names(G9) === keep, w.error);
  w = await sb.from("game_lineup_slots").insert({ organization_id: A, season_id: SEASON_A, game_id: G9, player_id: PL(10), batting_order: 5 });
  ok("inserting a batter into the middle is refused", !!w.error && count(G9) === 9, w.error);
  w = await sb.from("game_lineup_slots").insert({ organization_id: A, season_id: SEASON_A, game_id: G9, player_id: PL(10), batting_order: 12 });
  ok("inserting a batter with a gap in numbering is refused", !!w.error && count(G9) === 9, w.error);
  w = await sb.from("game_lineup_slots").insert({ organization_id: A, season_id: SEASON_A, game_id: G9, player_id: PL(10), batting_order: 10 });
  ok("inserting a late batter at the end is allowed", !w.error && count(G9) === 10, w.error);
  w = await sb.from("game_lineup_slots").update({ player_id: PL(11) }).eq("game_id", G9).eq("batting_order", 3).select("id");
  ok("changing which player holds a slot directly is allowed (that is what Substitute does)", !w.error && count(G9) === 10, w.error);
  sql(`update game_lineup_slots set player_id='${PL(3)}' where game_id='${G9}' and batting_order=3`);
  as("coach");

  section("TRACKED GAME: Substitute, Copy and Clear");
  await reset9();
  r = await L.substitutePlayer(G9, 4, PL(10));
  ok("Substitute still works in a tracked game", r.ok === true && names(G9) === "p01 p02 p03 p10 p05 p06 p07 p08 p09", r);
  ok("...and p04's at-bat stays with p04 at slot 4", paRows(G9).some((x) => x.player_id === PL(4) && x.batting_order === 4));
  r = await L.copyLineupFrom(G9, G(1), { replace: true });
  await L.saveLineup(G(1), ids(1, 2, 3));
  r = await L.copyLineupFrom(G9, G(1), { replace: true });
  ok("Copy lineup into a tracked game is refused with a plain explanation", r.ok === false && /already being tracked/.test(r.error), r);
  r = await L.saveLineup(G9, []);
  ok("Clear lineup is refused in a tracked game", r.ok === false && count(G9) === 9, r);
  sql(`delete from game_lineup_slots where game_id='${G(1)}'`);
  sql(`update plate_appearances set voided_at = now() where game_id='${G9}'`);
  r = await L.saveLineup(G9, ids(9, 8, 7));
  ok("after every at-bat is undone (voided) the order is editable again", r.ok === true && names(G9) === "p09 p08 p07", r);

  /* ===================== late arrivals ===================== */
  section("LATE ARRIVALS: added at the end, before the order wraps and after");
  const { lateArrivalTiming, lateArrivalMessage } = require(path.join(ROOT, "lib", "lineup-rules.js"));
  // Walk the real tracker cursor forward from where it points after the late batter is added,
  // to count how many batters bat before the new one. This is what the screen text must match.
  const battersBeforeNew = (order, rows, newSlot) => {
    let idx = resumePosition(order, rows).index, n = 0;
    while (order[idx].batting_order !== newSlot) { idx = (idx + 1) % order.length; n++; if (n > 60) return -1; }
    return n;
  };
  const cases = [
    ["before the order wraps: last at-bat in slot 4 of 9", [1, 2, 3, 4], 5],
    ["only the first batter has batted (slot 1 of 9)", [1], 8],
    ["right at the boundary: last at-bat in slot 9 of 9, order about to wrap", [1, 2, 3, 4, 5, 6, 7, 8, 9], 0],
    ["after the order wraps: slots 1 to 9, then 1 and 2 (second time through)", [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2], 7],
    ["well into the second pass: last at-bat in slot 8 of 9", [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8], 1],
    ["after wrapping, last at-bat in slot 9 again (end of the second pass)", [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0],
  ];
  for (const [label, seq, expectAhead] of cases) {
    sql(`delete from plate_appearances where game_id='${G9}'`);
    sql(`delete from game_lineup_slots where game_id='${G9}'`);
    await L.saveLineup(G9, original);
    const seen = {};
    for (const slot of seq) { seen[slot] = (seen[slot] ?? 0) + 1; addPa(G9, slot, slot, seen[slot]); }
    const before = lateArrivalTiming(lineupOf(G9), paRows(G9));
    r = await L.saveLineup(G9, [...original, PL(10)]);
    const after = lineupOf(G9);
    const real = battersBeforeNew(after, paRows(G9), 10);
    console.log(`  ${label}\n    screen says: ${lateArrivalMessage(before, 1)}\n    tracker walk: ${real} batter(s) bat before p10\n`);
    ok(`${label}: the late batter is saved as slot 10 and slots 1 to 9 are unchanged`, r.ok === true && names(G9) === keep + " p10", r);
    ok(`${label}: ${expectAhead} batter(s) bat before them, and the lineup screen's timing agrees with the real tracker`, before.ahead === expectAhead && real === expectAhead, { before, real });
    ok(`${label}: at-bats untouched`, paRows(G9).length === seq.length);
    ok(`${label}: the late batter never gets the turns already taken (no at-bats for them yet)`, !paRows(G9).some((x) => x.player_id === PL(10)));
    ok(`${label}: wording matches the case`, expectAhead === 0 ? /bats next/.test(lateArrivalMessage(before, 1)) : new RegExp(`${expectAhead} batters?`).test(lateArrivalMessage(before, 1)));
  }
  // Two late arrivals in one save are added in the order given.
  sql(`delete from plate_appearances where game_id='${G9}'`); sql(`delete from game_lineup_slots where game_id='${G9}'`);
  await L.saveLineup(G9, original); addPa(G9, 1, 1, 1); addPa(G9, 2, 2, 1);
  r = await L.saveLineup(G9, [...original, PL(10), PL(12 - 1)].filter((x) => x !== PL(11)));
  ok("two late arrivals in one save take slots 10 and 11 in the order given", r.ok === true && count(G9) === 10, r);
  r = await L.saveLineup(G9, [...original, PL(10), PL(5)]);
  ok("a player already in the order cannot be added again", r.ok === false, r);
  const aud = sequenceAudit(lineupOf(G9), paRows(G9));
  ok("the sequence audit stays clean after late arrivals", aud.violations.length === 0 && aud.unplaceable === 0, aud);

  /* ===================== recovery: at-bats exist, no saved order ===================== */
  section("RECOVERY: a tracked game whose saved order is empty is a rebuild, not a late arrival");
  sql(`delete from plate_appearances where game_id='${G9}'`); sql(`delete from game_lineup_slots where game_id='${G9}'`);
  await L.saveLineup(G9, original);
  addPa(G9, 1, 1, 1); addPa(G9, 2, 2, 1); addPa(G9, 3, 3, 1);
  sql(`alter table game_lineup_slots disable trigger guard_lineup_slots`);
  sql(`delete from game_lineup_slots where game_id='${G9}'`); // how it got there: an old clear, or a clear that won a race (see concurrency tests)
  sql(`alter table game_lineup_slots enable trigger guard_lineup_slots`);
  ok("setup: 3 at-bats recorded and the saved order is empty", count(G9) === 0 && paRows(G9).length === 3);
  r = await L.saveLineup(G9, ids(1, 2, 3, 4, 5, 6, 7, 8, 9));
  ok("an ordinary save is refused with a clear 'needs confirmation' answer, nothing is written", r.ok === false && r.code === "needsRebuildConfirm" && count(G9) === 0, r);
  ok("...and the message does not call it a late arrival", !/late/i.test(r.error), r.error);
  r = await L.saveLineup(G9, ids(1, 2, 3, 4, 5, 6, 7, 8, 9), { rebuild: true });
  ok("with an explicit rebuild it is saved", r.ok === true && r.rebuilt === true && names(G9) === keep, r);
  ok("...and is worded as a rebuild, with the slot-number warning, not as late batters", /rebuilt/.test(r.notice) && /original slot numbers/.test(r.notice) && !/late/i.test(r.notice), r.notice);
  ok("the recorded at-bats are untouched and the tracker resumes at slot 4", paRows(G9).length === 3 && resumePosition(lineupOf(G9), paRows(G9)).index === 3);
  r = await L.saveLineup(G9, ids(9, 8, 7, 6, 5, 4, 3, 2, 1), { rebuild: true });
  ok("once rebuilt the game is locked again: passing rebuild does not unlock a game that has an order", r.ok === false && names(G9) === keep, r);
  r = await L.saveLineup(G9, [...original, PL(10)]);
  ok("after the rebuild, a late arrival is an ordinary late arrival again", r.ok === true && r.rebuilt === false && /late/i.test(r.notice) && names(G9) === keep + " p10", r);
  r = await L.saveLineup(G9, []);
  ok("clearing a tracked game is refused even when rebuilding is allowed", r.ok === false && count(G9) === 10, r);

  /* ===================== concurrency ===================== */
  section("CONCURRENCY: real parallel database connections, one lock per game");
  const { Client } = require("pg");
  const conn = async (u = USERS.coach) => {
    const c = new Client({ connectionString: process.env.DB_URI });
    await c.connect();
    await c.query("set role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: u.id })]);
    return c;
  };
  const waitForLockWait = async (n = 1) => {
    for (let i = 0; i < 200; i++) {
      if (Number(sql("select count(*) from pg_locks where locktype='advisory' and not granted")) >= n) return true;
      await new Promise((rs) => setTimeout(rs, 25));
    }
    return false;
  };
  const resetGame = (g, list, pas = 0) => {
    sql(`delete from plate_appearances where game_id='${g}'`);
    sql(`delete from game_lineup_slots where game_id='${g}'`);
    list.forEach((n, i) => sql(`insert into game_lineup_slots (organization_id, season_id, game_id, player_id, batting_order) values ('${A}','${SEASON_A}','${g}','${PL(n)}',${i + 1})`));
    for (let i = 1; i <= pas; i++) addPa(g, i, i, 1);
  };
  const replaceSql = (c, g, list) => c.query("select replace_game_lineup($1::uuid, $2::uuid[])", [g, list.map(PL)]);
  const paSql = (c, g, n, slot, paNo = 1) => c.query(
    "insert into plate_appearances (organization_id, season_id, game_id, player_id, pa_number, batting_order) values ($1,$2,$3,$4,$5,$6)",
    [A, SEASON_A, g, PL(n), paNo, slot]);
  const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const swapped = [1, 2, 7, 4, 5, 6, 3, 8, 9];
  const G5 = G(5);

  // 1. Many simultaneous saves of an untracked game: one whole winner, never a mix.
  let allWhole = true, noErrors = true;
  for (let round = 0; round < 5; round++) {
    resetGame(G(2), []);
    const lists = [...Array(8)].map((_, k) => [...nine].sort((a, b) => ((a * (k + 3)) % 11) - ((b * (k + 3)) % 11)).slice(0, 5));
    const clients = await Promise.all(lists.map(() => conn()));
    const results = await Promise.allSettled(clients.map((c, k) => replaceSql(c, G(2), lists[k])));
    noErrors = noErrors && results.every((x) => x.status === "fulfilled");
    const final = lineupOf(G(2)).map((x) => x.player_id);
    const contiguous = lineupOf(G(2)).every((x, i) => x.batting_order === i + 1);
    allWhole = allWhole && contiguous && final.length === 5 && lists.some((l) => JSON.stringify(l.map(PL)) === JSON.stringify(final));
    await Promise.all(clients.map((c) => c.end()));
  }
  ok("8 simultaneous saves, 5 rounds: every save succeeded (they queue, they do not collide)", noErrors);
  ok("...and every round ends with exactly one complete lineup, numbered 1 to 5, never a mix of two", allWhole);

  // 2. An at-bat is mid-write when a reorder arrives: the reorder waits, then is refused.
  resetGame(G5, nine);
  let pc = await conn(), rc = await conn();
  await pc.query("begin"); await paSql(pc, G5, 1, 1);
  const reorder2 = replaceSql(rc, G5, swapped).then(() => "accepted", (e) => e.message);
  ok("the reorder is waiting on the game lock while the at-bat is uncommitted", await waitForLockWait());
  await pc.query("commit");
  const out2 = await reorder2;
  ok("when the at-bat commits, the waiting reorder is REFUSED", /already being tracked/.test(out2), out2);
  ok("...the order is unchanged and the at-bat is recorded", names(G5) === keep && paRows(G5).length === 1);
  await pc.end(); await rc.end();

  // 3. A reorder is mid-save when an at-bat arrives: the at-bat waits and is then recorded, never rejected.
  resetGame(G5, nine);
  pc = await conn(); rc = await conn();
  await rc.query("begin"); await replaceSql(rc, G5, swapped);
  const pa3 = paSql(pc, G5, 1, 1).then(() => "recorded", (e) => e.message);
  ok("the at-bat is waiting while the reorder is uncommitted", await waitForLockWait());
  await rc.query("commit");
  ok("the at-bat is then recorded (an at-bat is never refused because of a lineup change)", (await pa3) === "recorded");
  ok("the reorder committed first, so it stands", names(G5) === "p01 p02 p07 p04 p05 p06 p03 p08 p09");
  r = await L.saveLineup(G5, nine.map(PL).map((x) => x));
  ok("from that moment the game is tracked and the order is locked", r.ok === false && /already being tracked/.test(r.error), r);
  await pc.end(); await rc.end();

  // 4. Clear in flight while an at-bat arrives (a tracker open on a stale page).
  resetGame(G5, nine);
  pc = await conn(); rc = await conn();
  await rc.query("begin"); await replaceSql(rc, G5, []);
  const pa4 = paSql(pc, G5, 1, 1).then(() => "recorded", (e) => e.message);
  await waitForLockWait();
  await rc.query("commit");
  ok("a clear that wins the race is followed by the at-bat being recorded, not lost", (await pa4) === "recorded" && count(G5) === 0 && paRows(G5).length === 1);
  console.log("    (residual: the at-bat then has no slot to attach to; see the proposal doc. It is recorded, and Set lineup repairs the order.)");
  await pc.end(); await rc.end();

  // 5. Late arrival added while an at-bat is being recorded: both succeed, consistently.
  resetGame(G5, nine, 1);
  pc = await conn(); rc = await conn();
  await rc.query("begin"); await replaceSql(rc, G5, [...nine, 10]);
  const pa5 = paSql(pc, G5, 2, 2).then(() => "recorded", (e) => e.message);
  await waitForLockWait();
  await rc.query("commit");
  ok("a late arrival and an at-bat in the same moment both succeed", (await pa5) === "recorded" && names(G5) === keep + " p10" && paRows(G5).length === 2);
  await pc.end(); await rc.end();

  // 6. The last at-bat is being undone while a reorder arrives: decided in one order.
  resetGame(G5, nine, 1);
  pc = await conn(); rc = await conn();
  await pc.query("begin"); await pc.query("update plate_appearances set voided_at = now() where game_id = $1", [G5]);
  const reorder6 = replaceSql(rc, G5, swapped).then(() => "accepted", (e) => e.message);
  await waitForLockWait();
  await pc.query("commit");
  ok("undo commits first, so the reorder that was waiting is now allowed (no at-bats are active)", (await reorder6) === "accepted" && names(G5) === "p01 p02 p07 p04 p05 p06 p03 p08 p09");
  await pc.end(); await rc.end();

  // 7. Two coaches add different late arrivals at once: exactly one wins, the other is told to reload.
  resetGame(G5, nine, 2);
  const [c1, c2] = [await conn(), await conn()];
  const both = await Promise.allSettled([replaceSql(c1, G5, [...nine, 10]), replaceSql(c2, G5, [...nine, 12])]);
  const won = both.filter((x) => x.status === "fulfilled").length;
  ok("two simultaneous late arrivals: exactly one saves", won === 1, both.map((x) => x.status));
  ok("...the loser is told the order changed, and the order is contiguous 1 to 10", both.some((x) => x.status === "rejected" && /already being tracked/.test(x.reason.message)) && count(G5) === 10 && lineupOf(G5).every((x, i) => x.batting_order === i + 1));
  await c1.end(); await c2.end();

  // 8. Substitute while a late arrival saves: both apply.
  resetGame(G5, nine, 2);
  pc = await conn(); rc = await conn();
  await rc.query("begin"); await replaceSql(rc, G5, [...nine, 10]);
  const sub8 = pc.query("update game_lineup_slots set player_id = $1 where game_id = $2 and batting_order = 5", [PL(11 - 0), G5]).then(() => "ok", (e) => e.message);
  await waitForLockWait();
  await rc.query("commit");
  const subOut = await sub8;
  ok("a substitution waiting behind a late-arrival save applies afterwards, and the late batter is kept", subOut === "ok" && names(G5).endsWith("p10") && lineupOf(G5)[4].player_id === PL(11));
  await pc.end(); await rc.end();

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
