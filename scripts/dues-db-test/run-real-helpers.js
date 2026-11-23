/**
 * Permission tests for player dues schedules against the REAL production sign-in helpers.
 *
 *   createdb duesreal
 *   psql duesreal -f scripts/dues-db-test/fixture-real-helpers.sql
 *   psql duesreal -1 -f supabase/migrations/20261123223848_player_dues_schedules.sql
 *   DUES_REAL_DATABASE_URL=postgres://localhost/duesreal node scripts/dues-db-test/run-real-helpers.js
 *
 * People are real rows (profiles, memberships, team memberships, guardians) and each call
 * runs as role "authenticated" with request.jwt.claim.sub set, exactly how Supabase signs a
 * person in. The helpers are production's own text. Skips when the variable is unset.
 */
const URL = process.env.DUES_REAL_DATABASE_URL;
if (!URL) { console.log("dues-db-test (real helpers): DUES_REAL_DATABASE_URL not set, skipped."); process.exit(0); }
let Client;
try { ({ Client } = require("pg")); } catch { console.log("dues-db-test (real helpers): 'pg' not installed, skipped."); process.exit(0); }
const crypto = require("crypto");
const uuid = () => crypto.randomUUID();

let ran = 0, failed = 0;
function ok(label, cond, extra) {
  ran += 1;
  if (!cond) { failed += 1; console.log(`  FAIL  ${label}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`); }
  else console.log(`  ok    ${label}`);
}

(async () => {
  const sa = new Client({ connectionString: URL }); await sa.connect();
  const c = new Client({ connectionString: URL }); await c.connect();
  const q = (sql, p) => sa.query(sql, p);

  // ---- people and places -------------------------------------------------
  const orgA = uuid(), orgB = uuid(), tA1 = uuid(), tA2 = uuid(), tB1 = uuid(), sA1 = uuid(), sA2 = uuid(), sB1 = uuid();
  await q("insert into organizations(id,name) values ($1,'Org A'),($2,'Org B')", [orgA, orgB]);
  await q("insert into teams(id,organization_id) values ($1,$2),($3,$2),($4,$5)", [tA1, orgA, tA2, tB1, orgB]);
  await q("insert into seasons(id,team_id) values ($1,$2),($3,$4),($5,$6)", [sA1, tA1, sA2, tA2, sB1, tB1]);
  const U = {};
  const person = async (key, org, authority, legacy, teams = []) => {
    const id = uuid(); U[key] = id;
    await q("insert into profiles(id,full_name,role,active_organization_id) values ($1,$2,$3,$4)", [id, key, legacy, org]);
    if (org) await q("insert into organization_memberships(organization_id,user_id,authority,legacy_role) values ($1,$2,$3,$4)", [org, id, authority, legacy]);
    for (const t of teams) await q("insert into team_memberships(profile_id,team_id,role) values ($1,$2,$3)", [id, t, legacy]);
  };
  await person("ownerA", orgA, "owner", "owner");
  await person("coachA1", orgA, "member", "coach", [tA1]);
  await person("coachA2", orgA, "member", "coach", [tA2]);
  await person("parentLinked", orgA, "member", "parent", [tA1]);
  await person("parentOther", orgA, "member", "parent", [tA1]);
  await person("ownerB", orgB, "owner", "owner");
  await person("loner", null, "", "coach");
  // a coach of team A1 whose ACTIVE organization is B (membership in both): must act as B only
  await person("splitCoach", orgB, "member", "coach", [tA1]);
  await q("insert into organization_memberships(organization_id,user_id,authority,legacy_role) values ($1,$2,'member','coach')", [orgA, U.splitCoach]);

  // players and dues: two in A1 (one linked to parentLinked), one in A2, one in B1
  const mkPlayer = async (org, season, name, total) => {
    const pid = uuid(), id = uuid();
    await q("insert into players(id,organization_id,full_name) values ($1,$2,$3)", [pid, org, name]);
    await q("insert into player_payments(id,organization_id,player_id,player_name,initial_cost,season_id) values ($1,$2,$3,$4,$5,$6)", [id, org, pid, name, total, season]);
    return { id, pid };
  };
  const a1 = await mkPlayer(orgA, sA1, "A1 linked child", 3600), a1b = await mkPlayer(orgA, sA1, "A1 other child", 3600);
  const a2 = await mkPlayer(orgA, sA2, "A2 child", 3600), b1 = await mkPlayer(orgB, sB1, "B1 child", 3600);
  await q("insert into player_guardians(organization_id,profile_id,player_id) values ($1,$2,$3)", [orgA, U.parentLinked, a1.pid]);

  // ---- acting as a signed-in person ---------------------------------------
  const asUser = async (who, sql, params = []) => {
    await c.query("begin");
    try {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [U[who] ?? uuid()]);
      const r = await c.query(sql, params); await c.query("commit"); return r.rows;
    } catch (e) { await c.query("rollback"); throw e; }
  };
  const call = async (who, name, ...params) => (await asUser(who, `select public.${name}(${params.map((_, i) => "$" + (i + 1) + (typeof params[i] === "object" && params[i] !== null && !Array.isArray(params[i]) || Array.isArray(params[i]) && typeof params[i][0] === "object" ? "::jsonb" : "")).join(",")}) as r`, params.map((x) => (x !== null && typeof x === "object" && !(Array.isArray(x) && (x.length === 0 || typeof x[0] === "string")) ? JSON.stringify(x) : x))))[0].r;
  const chris = [["2026-09-01", 1100], ["2026-10-01", 500], ["2026-11-01", 500], ["2026-12-01", 500], ["2027-01-01", 500], ["2027-02-01", 500]].map(([due_date, amount]) => ({ due_date, amount }));
  const refused = (r) => r && r.ok === false && ["not_found", "forbidden"].includes(r.code);

  console.log("\nWho can save a team schedule\n");
  const tOwner = await call("ownerA", "save_dues_template", sA1, null, null, "Standard", chris, true);
  ok("owner of org A can save for team A1's season", tOwner.ok === true, tOwner);
  const tOwner2 = await call("ownerA", "save_dues_template", sA2, null, null, "Standard", chris, true);
  ok("owner of org A can save for team A2's season (owners reach every team in their organization)", tOwner2.ok === true, tOwner2);
  const tCoach = await call("coachA1", "save_dues_template", sA1, null, null, "Coach copy", chris, false);
  ok("a coach can save for their own team's season", tCoach.ok === true, tCoach);
  ok("a coach cannot save for another team's season in the same organization", refused(await call("coachA1", "save_dues_template", sA2, null, null, "X", chris, false)));
  ok("another organization's owner cannot save for this season", refused(await call("ownerB", "save_dues_template", sA1, null, null, "X", chris, false)));
  ok("a person with no membership cannot save", refused(await call("loner", "save_dues_template", sA1, null, null, "X", chris, false)));
  ok("a parent cannot save", refused(await call("parentLinked", "save_dues_template", sA1, null, null, "X", chris, false)));
  ok("a coach whose active organization is B cannot act on organization A's team (even though they sit on its team)", refused(await call("splitCoach", "save_dues_template", sA1, null, null, "X", chris, false)));
  ok("no template was created by any refused call", (await q("select count(*)::int c from dues_schedule_templates")).rows[0].c === 3);

  console.log("\nPreview, apply, snapshot and save: same boundaries\n");
  const tpl = tOwner.id, rev = tOwner.revision;
  const pv = await call("coachA1", "preview_dues_schedule", tpl, [a1.id, a1b.id, a2.id, b1.id]);
  ok("preview shows team A1's own players only (A2 and B players are not returned)", pv.ok && pv.players.length === 2 && pv.players.every((p) => [a1.id, a1b.id].includes(p.payment_id)), pv.players?.map((p) => p.payment_id));
  ok("a coach of A2 cannot preview A1's schedule", refused(await call("coachA2", "preview_dues_schedule", tpl, [a1.id])));
  ok("another organization cannot preview it", refused(await call("ownerB", "preview_dues_schedule", tpl, [a1.id])));
  ok("a parent cannot preview", refused(await call("parentLinked", "preview_dues_schedule", tpl, [a1.id])));
  const v = (id, who = "ownerA") => asUser(who, "select public.dues_state_version($1) v", [id]).then((r) => r[0].v);
  const entry = async (p) => [{ payment_id: p.id, expected_version: await v(p.id), replace: false }];
  ok("another organization cannot apply A's schedule to A's players", refused(await call("ownerB", "apply_dues_schedule", tpl, uuid(), rev, await entry(a1))));
  ok("a coach of team A2 cannot apply A1's schedule", refused(await call("coachA2", "apply_dues_schedule", tpl, uuid(), rev, await entry(a1))));
  ok("a parent cannot apply, even to their own child", refused(await call("parentLinked", "apply_dues_schedule", tpl, uuid(), rev, await entry(a1))));
  ok("the owner cannot apply A's schedule to another organization's player", (await call("ownerA", "apply_dues_schedule", tpl, uuid(), rev, await entry(b1))).ok === false);
  ok("nothing was written by any refused apply", (await q("select count(*)::int c from dues_installments")).rows[0].c === 0);
  const ap = await call("coachA1", "apply_dues_schedule", tpl, uuid(), rev, await entry(a1));
  ok("a coach of team A1 can apply to team A1's player", ap.ok === true && ap.applied === 1, ap);
  ok("snapshot: refused for another team's coach, another organization and a parent",
    refused(await call("coachA2", "dues_player_snapshot", a1.id)) && refused(await call("ownerB", "dues_player_snapshot", a1.id)) && refused(await call("parentLinked", "dues_player_snapshot", a1.id)));
  ok("snapshot: allowed for the team's coach", (await call("coachA1", "dues_player_snapshot", a1.id)).ok === true);
  const sv = (who, id) => call(who, "save_player_dues", id, "x", 3600, false, null);
  ok("save_player_dues: another organization, another team and a parent are all refused", refused(await sv("ownerB", a1.id)) && refused(await sv("coachA2", a1.id)) && refused(await sv("parentLinked", a1.id)));
  ok("save_player_dues: wrong version is refused for the right coach (not a permission failure)", (await sv("coachA1", a1.id)).code === "changed");
  ok("dues_state_version reveals nothing across teams or organizations", (await v(a1.id, "ownerB")) === null && (await v(a1.id, "coachA2")) === null && (await v(a1.id, "loner")) === null);

  console.log("\nReading the tables (row level security)\n");
  const seen = async (who, table) => (await asUser(who, `select count(*)::int c from public.${table}`))[0].c;
  const a1bApply = await call("ownerA", "apply_dues_schedule", tpl, uuid(), rev, await entry(a1b));
  ok("owner applies team A1's schedule to the second A1 player", a1bApply.ok === true, a1bApply);
  const a2apply = await call("ownerA", "apply_dues_schedule", tOwner2.id, uuid(), tOwner2.revision, await entry(a2));
  ok("owner applies team A2's schedule to team A2's player", a2apply.ok === true, a2apply);
  const total = (await q("select count(*)::int c from dues_installments")).rows[0].c;
  ok("setup: three players have schedules (18 installments)", total === 18, total);
  ok("owner A reads every team's installments in organization A", (await seen("ownerA", "dues_installments")) === 18);
  ok("a coach reads only their own team's installments (12 = two A1 players)", (await seen("coachA1", "dues_installments")) === 12);
  ok("the other team's coach reads only theirs (6)", (await seen("coachA2", "dues_installments")) === 6);
  ok("another organization reads none", (await seen("ownerB", "dues_installments")) === 0 && (await seen("ownerB", "dues_schedule_templates")) === 0);
  ok("a person with no membership reads none", (await seen("loner", "dues_installments")) === 0 && (await seen("loner", "dues_schedule_templates")) === 0);
  ok("a coach of the other organization-member team reads only their team's templates", (await seen("coachA2", "dues_schedule_templates")) === 1);
  ok("the split-membership coach acting as organization B reads nothing of A", (await seen("splitCoach", "dues_installments")) === 0);
  ok("a linked parent reads ONLY their child's installments (6), matching what they can read of payments", (await seen("parentLinked", "dues_installments")) === 6 && (await seen("parentLinked", "player_payments")) === 1);
  ok("an unlinked parent reads no installments", (await seen("parentOther", "dues_installments")) === 0 && (await seen("parentOther", "player_payments")) === 0);
  ok("parents never read team schedule templates", (await seen("parentLinked", "dues_schedule_templates")) === 0);

  console.log("\nWriting the tables directly\n");
  const denied = async (who, sql, p = []) => { try { await asUser(who, sql, p); return false; } catch { return true; } };
  ok("nobody can insert installments directly", await denied("ownerA", "insert into dues_installments(organization_id,season_id,payment_id,seq,due_date,amount) values ($1,$2,$3,9,'2027-03-01',1)", [orgA, sA1, a1.id]));
  const affected = async (who, sql, p = []) => { await c.query("begin"); try { await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [U[who]]); const r = await c.query(sql, p); await c.query("rollback"); return r.rowCount; } catch { await c.query("rollback"); return -1; } };
  ok("nobody can update or delete installments directly", (await affected("ownerA", "update dues_installments set amount = 1")) <= 0 && (await affected("ownerA", "delete from dues_installments")) <= 0);
  ok("nobody can write templates directly", (await affected("ownerA", "update dues_schedule_templates set items = '[]'::jsonb")) <= 0 && await denied("ownerA", "insert into dues_schedule_templates(organization_id,season_id,name,items) values ($1,$2,'x','[]')", [orgA, sA1]));
  ok("signed-out callers (anon) cannot call the functions", await (async () => { await c.query("begin"); try { await c.query("set local role anon"); await c.query("select public.dues_player_snapshot($1)", [a1.id]); await c.query("rollback"); return false; } catch { await c.query("rollback"); return true; } })());
  ok("every schedule table has row level security on", (await q("select count(*)::int c from pg_class where relname in ('dues_installments','dues_schedule_templates') and relrowsecurity")).rows[0].c === 2);

  await c.end(); await sa.end();
  console.log(`\n${ran - failed}/${ran} passed${failed ? `, ${failed} FAILED` : ""}\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("real-helper tests crashed:", e); process.exit(1); });
