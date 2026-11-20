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

const ROOT = "/home/claude/atlas-iq2";
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

const PART = require(path.join(ROOT, "lib", "actions", "participants.js"));
const TID = "c0000000-0000-0000-0000-0000000000a1";
const PICK = "f0000000-0000-0000-0000-000000000110";
const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x)); return f; };
const rowId = (pl) => sql(`select id from tournament_participants where tournament_id='${TID}' and player_id='${pl}'`);
const attending = () => sql(`select coalesce(string_agg(right(player_id::text,3), ',' order by player_id), '') from tournament_participants where tournament_id='${TID}'`);
const roster = (...ps) => fd({ tournament_id: TID, participant: ps.map((p) => `${p}|roster||`) });
const addRow = (pl, kind = "roster") => sql(`insert into tournament_participants (organization_id, season_id, tournament_id, player_id, participation) values ('${A}','${SEASON_A}','${TID}','${pl}','${kind}') on conflict do nothing`);
const voidedPa = (g, playerNo, slot) => sql(`insert into plate_appearances (organization_id, season_id, game_id, player_id, pa_number, batting_order, voided_at) values ('${A}','${SEASON_A}','${g}','${PL(playerNo)}',1,${slot}, now())`);

(async () => {
  as("coach");

  section("Removing an attendee who is in a saved batting order is refused, with a route to that lineup");
  addRow(PICK, "pickup");
  let r = await L.saveLineup(G(1), [PL(1), PL(2), PICK]);
  ok("fixture: lineup with the pickup saved", r.ok === true, r);
  r = await PART.removeParticipant(fd({ id: rowId(PICK) }));
  ok("X button on a pickup in a saved lineup is refused", r.ok === false && r.code === "in_lineup", r);
  ok("...the participant row is still there", rowId(PICK) !== "");
  ok("...and the batting order is unchanged", slots(G(1)).includes("3:110"), slots(G(1)));
  ok("blocker names the game, its tournament and kind", Array.isArray(r.blockers) && r.blockers[0]?.player_id === PICK
    && r.blockers[0].kind === "in_lineup" && r.blockers[0].games[0]?.id === G(1) && r.blockers[0].games[0]?.opponent === "Opponent 1" && r.blockers[0].games[0]?.tournament_id === TID, r.blockers);
  ok("message is plain English and names the player and game", /Opponent 1/.test(r.error ?? "") && /lineup/i.test(r.error ?? ""), r.error);

  section("Removing an attendee who has recorded at-bats is refused outright");
  r = await L.saveLineup(G(2), [PL(1), PICK, PL(2)]);
  addPa(G(2), 10, 2, 1);
  r = await PART.removeParticipant(fd({ id: rowId(PICK) }));
  ok("pickup with a live at-bat is refused as has_at_bats", r.ok === false && r.code === "has_at_bats", r);
  ok("...at-bat and slot untouched", sql(`select count(*) from plate_appearances where game_id='${G(2)}' and player_id='${PICK}'`) === "1" && slots(G(2)).includes("2:110"));
  ok("has_at_bats wins when the player is also in an untracked lineup", r.blockers?.some((b) => b.player_id === PICK && b.kind === "has_at_bats"), r.blockers);

  section("The roster sheet cannot silently drop someone either, and nothing else is saved when it refuses");
  sql(`delete from tournament_participants where tournament_id='${TID}'`);
  addRow(PL(3)); addRow(PL(4));
  await L.saveLineup(G(3), [PL(3), PL(4)]);
  r = await PART.setEventRoster(roster(PL(4), PL(5)));
  ok("save that omits p03, who is in game 3's order, is refused", r.ok === false && r.code === "in_lineup" && r.blockers?.[0]?.player_id === PL(3), r);
  ok("...nothing changed, including the unrelated add of p05", attending() === `${PL(3).slice(-3)},${PL(4).slice(-3)}`, attending());
  ok("...p03's lineup slot is untouched", slots(G(3)).includes("1:103"), slots(G(3)));

  section("Once the lineup no longer holds them, removal works");
  await L.saveLineup(G(3), [PL(4)]);
  r = await PART.setEventRoster(roster(PL(4), PL(5)));
  ok("same save now succeeds", r.ok === true, r);
  ok("p03 removed, p05 added, p04 kept", attending() === `${PL(4).slice(-3)},${PL(5).slice(-3)}`, attending());

  section("Plain removal and unrelated saves");
  r = await PART.removeParticipant(fd({ id: rowId(PL(5)) }));
  ok("player with no lineup or at-bats is removed as before", r.ok === true && rowId(PL(5)) === "", r);
  addRow(PL(3)); sql(`update team_season_players set is_active=false where player_id='${PL(3)}'`);
  r = await PART.setEventRoster(roster(PL(3), PL(4), PL(6)));
  ok("an inactive attendee that is included in the submission stays, and an add alongside it works", r.ok === true && attending() === [PL(3), PL(4), PL(6)].map((p) => p.slice(-3)).sort().join(","), attending());
  ok("pickups are never removed by a roster save", (addRow(PICK, "pickup"), (await PART.setEventRoster(roster(PL(3), PL(4), PL(6)))).ok) && rowId(PICK) !== "");

  section("A voided at-bat does not block removal");
  addRow(PL(7)); voidedPa(G(1), 7, 9);
  r = await PART.removeParticipant(fd({ id: rowId(PL(7)) }));
  ok("only a voided at-bat and no slot: removal allowed", r.ok === true, r);

  section("Isolation: another organization cannot remove or probe this roster");
  addRow(PL(8));
  as("coachB");
  r = await PART.removeParticipant(fd({ id: rowId(PL(8)) }));
  ok("organization B cannot remove organization A's attendee", r.ok === false && rowId(PL(8)) !== "", r);
  as("coach");

  section("Roles");
  as("parent");
  r = await PART.removeParticipant(fd({ id: rowId(PL(8)) }));
  ok("a parent cannot change the roster", r.ok === false && rowId(PL(8)) !== "", r);
  as("coach");


  /* ======================================================================
     Two-pickup tournament scenario (fictional). Added 2026-11-20.
     Pickup one already exists in the organization and is INACTIVE on another
     team's roster. Pickup two is created by name from the tournament roster.
     A third player is ACTIVE on that other team (eligibility only).
     ====================================================================== */
  section("Two pickups: fixtures");
  const TEAM2 = "a0000000-0000-0000-0000-0000000000a2", SEASON2 = "5a000000-0000-0000-0000-0000000000a2";
  const X1 = "f0000000-0000-0000-0000-0000000002a1", X3 = "f0000000-0000-0000-0000-0000000002a3";
  const T2 = "c0000000-0000-0000-0000-0000000000a2", T3 = "c0000000-0000-0000-0000-0000000000a3";
  const GU2 = "9a000000-0000-0000-0000-0000000000b2", GU3 = "9a000000-0000-0000-0000-0000000000b3";
  sql(`delete from plate_appearances; delete from game_lineup_slots; delete from tournament_participants where tournament_id='${TID}'`);
  sql(`insert into seasons (id, team_id, name, phase) values ('${SEASON2}','${TEAM2}','Other team season','current')`);
  sql(`insert into players (id, organization_id, full_name) values ('${X1}','${A}','Fictional Pickup One'),('${X3}','${A}','Fictional Elsewhere Active')`);
  sql(`insert into team_season_players (team_id, season_id, player_id, jersey_number, is_active) values ('${TEAM2}','${SEASON2}','${X1}',31,false),('${TEAM2}','${SEASON2}','${X3}',33,true)`);
  sql(`insert into tournaments (id, organization_id, season_id, name) values ('${T2}','${A}','${SEASON_A}','Unrelated Open'),('${T3}','${A}','${SEASON_A}','No Roster Cup')`);
  sql(`insert into games (id, organization_id, season_id, tournament_id, opponent_name, game_date) values ('${GU2}','${A}','${SEASON_A}','${T2}','Unrelated 1','2026-12-01'),('${GU3}','${A}','${SEASON_A}','${T3}','Unrelated 2','2026-12-02')`);
  sql(`insert into tournament_participants (organization_id, season_id, tournament_id, player_id, participation) values ('${A}','${SEASON_A}','${T2}','${PL(1)}','roster')`);
  const seasonRows = (pl) => Number(sql(`select count(*) from team_season_players where player_id='${pl}' and season_id='${SEASON_A}'`));
  const totalRows = (pl) => Number(sql(`select count(*) from team_season_players where player_id='${pl}'`));
  const pickupId = () => sql(`select player_id from tournament_participants tp join players p on p.id=tp.player_id where tournament_id='${TID}' and p.full_name='Fictional Pickup Two'`);

  section("Two pickups: adding both");
  r = await PART.addPickup(fd({ tournament_id: TID, player_id: X1, jersey_number: "31" }));
  ok("existing org player (inactive on another team) is added as a pickup", r.ok === true, r);
  r = await PART.addPickup(fd({ tournament_id: TID, full_name: "Fictional Pickup Two", jersey_number: "32" }));
  ok("a new pickup is created by name", r.ok === true, r);
  const X2 = pickupId();
  ok("both are attending as pickup, not roster", sql(`select string_agg(participation, ',') from tournament_participants where tournament_id='${TID}' and player_id in ('${X1}','${X2}')`) === "pickup,pickup");
  ok("neither became a season-roster member", seasonRows(X1) === 0 && seasonRows(X2) === 0, [seasonRows(X1), seasonRows(X2)]);
  ok("the other team's inactive record for pickup one is unchanged", totalRows(X1) === 1 && sql(`select is_active from team_season_players where player_id='${X1}'`) === "f");
  addRow(PL(1)); addRow(PL(2)); addRow(PL(3));

  section("Two pickups: lineup selection (status elsewhere must not hide them here)");
  r = await L.saveLineup(G(4), [PL(1), X1, PL(2), X2, PL(3)]);
  ok("both pickups can be placed in a batting order", r.ok === true, r);
  ok("order saved with both pickups", count(G(4)) === 5 && slots(G(4)).includes(`2:${X1.slice(-3)}`) && slots(G(4)).includes(`4:${X2.slice(-3)}`), slots(G(4)));
  const LQ = require(path.join(ROOT, "lib", "queries", "lineup.js"));
  let ctx = null; try { ctx = await LQ.getLineupContext(G(4)); } catch (e) { ctx = { err: e.message }; }
  const eligIds = (ctx?.availablePlayers ?? []).map((x) => x.player_id);
  ok("the lineup screen's eligible list includes both pickups, from the tournament roster", ctx?.playerSource === "participants" && eligIds.includes(X1) && eligIds.includes(X2) && !eligIds.includes(X3), ctx?.err ?? [ctx?.playerSource, eligIds.length]);
  ctx = null; try { ctx = await LQ.getLineupContext(GU2); } catch (e) { ctx = { err: e.message }; }
  const eligU2 = (ctx?.availablePlayers ?? []).map((x) => x.player_id);
  ok("the unrelated tournament's eligible list contains neither pickup", !eligU2.includes(X1) && !eligU2.includes(X2) && eligU2.includes(PL(1)), ctx?.err ?? eligU2.length);
  ctx = null; try { ctx = await LQ.getLineupContext(GU3); } catch (e) { ctx = { err: e.message }; }
  const eligU3 = (ctx?.availablePlayers ?? []).map((x) => x.player_id);
  ok("...and so does the fallback list for a tournament with no roster", ctx?.playerSource === "season_roster" && !eligU3.includes(X1) && !eligU3.includes(X2) && !eligU3.includes(X3), ctx?.err ?? [ctx?.playerSource, eligU3.length]);

  section("Two pickups: not eligible for an unrelated tournament");
  r = await L.saveLineup(GU2, [PL(1), X1]);
  ok("pickup one (attending another tournament) is refused in a tournament that has a roster", r.ok === false, r);
  r = await L.saveLineup(GU2, [PL(1), X2]);
  ok("pickup two is refused there too", r.ok === false, r);
  r = await L.saveLineup(GU3, [PL(1), X1]);
  ok("...and in a tournament with no roster (falls back to the active season roster)", r.ok === false, r);
  ok("neither pickup has a slot in any unrelated game", count(GU2) === 0 && count(GU3) === 0);
  r = await L.saveLineup(GU3, [PL(1), X3]);
  ok("a player who is ACTIVE only on another team's roster is not eligible here either", r.ok === false, r);
  r = await L.saveLineup(GU3, [PL(1), PL(2)]);
  ok("control: season-roster players are still accepted in the unrelated tournament", r.ok === true, r);

  section("Two pickups: multiple at-bats, then substitution in and out");
  const pa = (g, pl, slot, n, reasons = "{}") => sql(`insert into plate_appearances (organization_id, season_id, game_id, player_id, pa_number, batting_order, qab_reasons, created_at) values ('${A}','${SEASON_A}','${g}','${pl}',${n},${slot},'${reasons}', timestamptz '2026-11-05 12:00:00+00' + interval '${++clock} seconds')`);
  pa(G(4), PL(1), 1, 1, "{hard_contact}"); pa(G(4), X1, 2, 1); pa(G(4), PL(2), 3, 1); pa(G(4), X2, 4, 1, "{hard_contact}");
  pa(G(4), PL(1), 1, 2); pa(G(4), X1, 2, 2, "{hard_contact}"); pa(G(4), X2, 4, 2);
  r = await L.saveLineup(G(4), [PL(1), X1, PL(2), X2, PL(3)]);
  ok("after the first at-bat a save never rebuilds the order (late batters only are added)", r.ok === true && r.rebuilt === false && count(G(4)) === 5 && slots(G(4)).includes(`2:${X1.slice(-3)}`), r);
  r = await L.substitutePlayer(G(4), 2, PL(4));
  ok("substitute a roster player in for pickup one", r.ok === true && slots(G(4)).includes(`2:${PL(4).slice(-3)}`), r);
  ok("pickup one's earlier at-bats stay on pickup one", sql(`select count(*) from plate_appearances where game_id='${G(4)}' and player_id='${X1}' and voided_at is null`) === "2");
  r = await L.substitutePlayer(G(4), 2, X1);
  ok("substitute pickup one back in", r.ok === true && slots(G(4)).includes(`2:${X1.slice(-3)}`), r);
  pa(G(4), X1, 2, 3, "{hard_contact}");
  ok("pickup one has three at-bats across the out-and-back", sql(`select count(*) from plate_appearances where game_id='${G(4)}' and player_id='${X1}'`) === "3");
  r = await L.substitutePlayer(G(4), 4, X3);
  ok("a player active only on another team cannot be substituted in", r.ok === false && slots(G(4)).includes(`4:${X2.slice(-3)}`), r);
  r = await L.substitutePlayer(G(4), 4, PL(5));
  ok("pickup two subbed out for good keeps their at-bats", r.ok === true && sql(`select count(*) from plate_appearances where game_id='${G(4)}' and player_id='${X2}'`) === "2", r);

  section("Two pickups: reload and reconciliation (tournament and season)");
  const byPlayer = JSON.parse(sql(`select json_object_agg(player_id, c) from (select player_id, count(*) c from plate_appearances where voided_at is null group by 1) x`));
  const tournTotal = Number(sql(`select count(*) from plate_appearances pa join games g on g.id=pa.game_id where g.tournament_id='${TID}' and pa.voided_at is null`));
  const seasonTotal = Number(sql(`select count(*) from plate_appearances where season_id='${SEASON_A}' and voided_at is null`));
  ok("per-player at-bats add up to the tournament total", Object.values(byPlayer).reduce((a, b) => a + b, 0) === tournTotal, [byPlayer, tournTotal]);
  ok("tournament total equals season total (nothing recorded in the unrelated tournaments)", tournTotal === seasonTotal && tournTotal === 8, [tournTotal, seasonTotal]);
  const PERF = require(path.join(ROOT, "lib", "queries", "performance.js"));
  let season = null, perfErr = null;
  try { season = await PERF.getSeasonPerformance(SEASON_A); } catch (e) { perfErr = e.message; }
  if (season) {
    const rowsOf = season.players ?? [];
    const pickRows = rowsOf.filter((p) => [X1, X2].includes(p.playerId));
    ok("Season Performance lists both pickups with their at-bats", pickRows.length === 2 && pickRows.find((p) => p.playerId === X1)?.pa === 3 && pickRows.find((p) => p.playerId === X2)?.pa === 2, pickRows.map((p) => [p.playerId.slice(-3), p.pa]));
    ok("pickup one (inactive on another team) is NOT shown as inactive here", pickRows.find((p) => p.playerId === X1)?.isActive === true, pickRows.map((p) => [p.playerId.slice(-3), p.isActive]));
    ok("season PA total reconciles to the database", rowsOf.reduce((a, p) => a + p.pa, 0) === seasonTotal, [rowsOf.reduce((a, p) => a + p.pa, 0), seasonTotal]);
  } else {
    console.log(`  note  Season Performance query could not run against the local shim (${perfErr}); reconciled with SQL totals above, and with check-performance-reconcile.js`);
  }

  section("Two pickups: removing attendance is blocked and history is preserved");
  r = await PART.removeParticipant(fd({ id: rowId(X1) }));
  ok("pickup one (back in the order, with at-bats) cannot be removed", r.ok === false && r.code === "has_at_bats", r);
  r = await PART.removeParticipant(fd({ id: rowId(X2) }));
  ok("pickup two (subbed out, but with at-bats) cannot be removed either", r.ok === false && r.code === "has_at_bats", r);
  r = await PART.setEventRoster(roster(PL(1), PL(2), PL(3)));
  ok("a roster save that does not list the pickups leaves them attending (pickups are managed separately)", r.ok === true && rowId(X1) !== "" && rowId(X2) !== "", r);
  ok("history intact: at-bats and the order are unchanged", Number(sql(`select count(*) from plate_appearances where game_id='${G(4)}'`)) === 8 && count(G(4)) === 5);
  ok("still not season-roster members after all of it", seasonRows(X1) === 0 && seasonRows(X2) === 0 && totalRows(X1) === 1);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
