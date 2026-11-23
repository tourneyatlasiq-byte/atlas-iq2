/**
 * Database tests for player dues schedules.
 *
 * Needs a SCRATCH Postgres (never production). Skips itself, successfully, when
 * DUES_TEST_DATABASE_URL is not set, so `npm run check` stays green on machines
 * without one.
 *
 *   createdb duestest
 *   psql duestest -f scripts/dues-db-test/fixture.sql
 *   psql duestest -f supabase/migrations/20261123223848_player_dues_schedules.sql
 *   DUES_TEST_DATABASE_URL=postgres://localhost/duestest node scripts/dues-db-test/run.js
 *
 * The fixture holds production's real payment functions and STUBS for the
 * sign-in helpers (auth_organization_id and friends). So these tests prove the
 * schedule logic, locking, versions and table permissions; they do not prove
 * Supabase's real sign-in behaviour.
 */
const URL = process.env.DUES_TEST_DATABASE_URL;
if (!URL) { console.log("dues-db-test: DUES_TEST_DATABASE_URL not set, skipped."); process.exit(0); }
let Client;
try { ({ Client } = require("pg")); } catch { console.log("dues-db-test: 'pg' not installed, skipped."); process.exit(0); }
const crypto = require("crypto");
const uuid = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ran = 0, failed = 0;
function ok(label, cond, extra) {
  ran += 1;
  if (!cond) { failed += 1; console.log(`  FAIL  ${label}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`); }
  else console.log(`  ok    ${label}`);
}
async function rejects(label, p, code) {
  ran += 1;
  try { await p; failed += 1; console.log(`  FAIL  ${label} (no error)`); }
  catch (e) {
    if (code && e.code !== code) { failed += 1; console.log(`  FAIL  ${label} (code ${e.code}: ${e.message})`); }
    else console.log(`  ok    ${label}`);
  }
}

const connect = async () => { const c = new Client({ connectionString: URL }); await c.connect(); return c; };
async function begin(c, ctx) {
  await c.query("begin");
  if (ctx) {
    await c.query("set local role authenticated");
    await c.query("select set_config('app.org',$1,true), set_config('app.role',$2,true), set_config('app.linked',$3,true)", [ctx.org, ctx.role ?? "owner", ctx.linked ?? ""]);
  }
}
// One call in its own transaction, as the signed-in person.
async function as(admin, ctx, sql, params = []) {
  await begin(admin, ctx);
  try { const r = await admin.query(sql, params); await admin.query("commit"); return r.rows; }
  catch (e) { await admin.query("rollback"); throw e; }
}
const fn = async (c, ctx, name, params) => (await as(c, ctx, `select public.${name}(${params.map((_, i) => "$" + (i + 1)).join(",")}) as r`, params))[0].r;
const jsonParams = (...v) => v.map((x) => (x !== null && typeof x === "object" ? JSON.stringify(x) : x));

(async () => {
  const sa = await connect(); // superuser: seeding and inspection only
  await sa.query("truncate public.dues_installments, public.dues_schedule_templates, public.payment_log, public.player_payment_operations, public.player_payments, public.players, public.seasons, public.organizations cascade").catch(async () => {
    await sa.query("delete from public.payment_log"); await sa.query("delete from public.player_payment_operations");
  });
  const orgA = uuid(), orgB = uuid(), seasonA = uuid(), seasonB = uuid();
  await sa.query("insert into public.organizations(id,name) values ($1,'A'),($2,'B')", [orgA, orgB]);
  await sa.query("insert into public.seasons(id,organization_id,name) values ($1,$2,'A26'),($3,$4,'B26')", [seasonA, orgA, seasonB, orgB]);
  const A = { org: orgA, role: "owner" }, B = { org: orgB, role: "owner" };
  const parentCtx = (linked) => ({ org: orgA, role: "parent", linked });
  let n = 0;
  const player = async (total, { org = orgA, season = seasonA, exempt = false } = {}) => {
    const pid = uuid(), id = uuid(); n += 1;
    await sa.query("insert into public.players(id,name) values ($1,$2)", [pid, `P${n}`]);
    await sa.query("insert into public.player_payments(id,organization_id,player_id,player_name,initial_cost,season_id,exempt) values ($1,$2,$3,$4,$5,$6,$7)", [id, org, pid, `P${n}`, total, season, exempt]);
    return { id, pid };
  };
  const version = async (id, ctx = A) => (await fn(sa2, ctx, "dues_state_version", [id]));
  const sa2 = await connect();
  const pay = (id, amt, date = "2026-09-05") => fn(sa2, A, "record_player_payment", [id, uuid(), null, amt, date, null]);
  const active = async (id) => (await sa.query("select seq, due_date::text d, amount::float a from public.dues_installments where payment_id=$1 and superseded_at is null order by seq", [id])).rows;
  const allRows = async (id) => (await sa.query("select superseded_reason r from public.dues_installments where payment_id=$1 order by created_at, seq", [id])).rows;
  const logState = async (id) => (await sa.query("select md5(coalesce(string_agg(concat_ws('|', id::text, amount::text, paid_date::text, coalesce(month_label,''), coalesce(request_key::text,'')), ';' order by id), '')) h, count(*)::int c from public.payment_log where payment_id=$1", [id])).rows[0];

  const chris = [["2026-09-01", 1100], ["2026-10-01", 500], ["2026-11-01", 500], ["2026-12-01", 500], ["2027-01-01", 500], ["2027-02-01", 500]]
    .map(([due_date, amount]) => ({ due_date, amount }));

  // -------------------------------------------------------------------------
  console.log("\nTeam schedule\n");
  const bad = await fn(sa2, A, "save_dues_template", jsonParams(seasonA, null, null, "Standard", [{ due_date: "2026-09-01", amount: 0 }], true));
  ok("a zero amount is refused", bad.ok === false && bad.code === "invalid", bad);
  const dup = await fn(sa2, A, "save_dues_template", jsonParams(seasonA, null, null, "Standard", [{ due_date: "2026-09-01", amount: 5 }, { due_date: "2026-09-01", amount: 5 }], true));
  ok("repeated dates are refused", dup.ok === false, dup);
  const cents = await fn(sa2, A, "save_dues_template", jsonParams(seasonA, null, null, "Standard", [{ due_date: "2026-09-01", amount: 10.005 }], true));
  ok("fractions of a cent are refused", cents.ok === false, cents);
  const t1 = await fn(sa2, A, "save_dues_template", jsonParams(seasonA, null, null, "Standard", chris, true));
  ok("Chris's exact schedule, past dates included, saves", t1.ok === true && t1.revision === 1, t1);
  const stale = await fn(sa2, A, "save_dues_template", jsonParams(seasonA, t1.id, 0, "Standard", chris, true));
  ok("a stale revision is refused and nothing changes", stale.ok === false && stale.code === "changed", stale);
  const t1b = await fn(sa2, A, "save_dues_template", jsonParams(seasonA, t1.id, 1, "Standard", chris, true));
  ok("the current revision saves and moves on", t1b.ok === true && t1b.revision === 2, t1b);
  const t2 = await fn(sa2, A, "save_dues_template", jsonParams(seasonA, null, null, "Other", chris.slice(0, 2).map((c) => ({ ...c, amount: 100 })), true));
  const defaults = (await sa.query("select count(*)::int c from public.dues_schedule_templates where season_id=$1 and is_default", [seasonA])).rows[0].c;
  ok("only one default per season", defaults === 1 && t2.ok, { defaults });
  await fn(sa2, A, "save_dues_template", jsonParams(seasonA, t1.id, 2, "Standard", chris, true));
  const other = await fn(sa2, B, "save_dues_template", jsonParams(seasonA, null, null, "Sneaky", chris, true));
  ok("another organization cannot write to this season", other.ok === false && other.code === "not_found", other);
  const coach = await fn(sa2, { org: orgA, role: "parent" }, "save_dues_template", jsonParams(seasonA, null, null, "P", chris, false));
  ok("a parent cannot save a team schedule", coach.ok === false && coach.code === "forbidden", coach);
  const tpl = t1.id;
  const tplRev = (await sa.query("select revision from public.dues_schedule_templates where id=$1", [tpl])).rows[0].revision;

  // -------------------------------------------------------------------------
  console.log("\nPreview and apply with payments already recorded\n");
  const zoe = await player(3600), ella = await player(3600), odd = await player(3000), ex = await player(0, { exempt: true }), none = await player(0);
  await pay(zoe.id, 1000, "2026-09-02"); await pay(zoe.id, 500, "2026-10-12");
  const before = await logState(zoe.id);
  const pv = await fn(sa2, A, "preview_dues_schedule", [tpl, [zoe.id, ella.id, odd.id, ex.id, none.id]]);
  const by = Object.fromEntries(pv.players.map((p) => [p.payment_id, p]));
  ok("preview: matching total will apply", by[zoe.id].outcome === "will_apply" && by[ella.id].outcome === "will_apply");
  ok("preview: a different total needs its own schedule", by[odd.id].outcome === "total_differs");
  ok("preview: exempt and no-dues players are skipped", by[ex.id].outcome === "exempt" && by[none.id].outcome === "no_dues");
  ok("preview returns the ACTUAL payments recorded, separate from the schedule", by[zoe.id].payments.length === 2 && Number(by[zoe.id].credited) === 1500 && by[zoe.id].payments[0].amount === 1000, by[zoe.id].payments);
  ok("preview writes nothing", (await active(zoe.id)).length === 0 && (await logState(zoe.id)).h === before.h);

  const batch = uuid();
  const entries = (list, replace = false) => list.map((p) => ({ payment_id: p.id, expected_version: p.v, replace }));
  const vz = await version(zoe.id), ve = await version(ella.id);
  const ap = await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, batch, tplRev, [{ payment_id: zoe.id, expected_version: vz, replace: false }, { payment_id: ella.id, expected_version: ve, replace: false }]));
  ok("apply succeeds for two players", ap.ok === true && ap.applied === 2 && ap.duplicate === false, ap);
  ok("each player gets six installments with Chris's exact amounts", JSON.stringify((await active(zoe.id)).map((r) => r.a)) === JSON.stringify([1100, 500, 500, 500, 500, 500]));
  const after = await logState(zoe.id);
  ok("applying never creates or changes a payment", after.h === before.h && after.c === 2 && (await logState(ella.id)).c === 0, { before, after });
  ok("total dues are untouched", Number((await sa.query("select initial_cost from public.player_payments where id=$1", [zoe.id])).rows[0].initial_cost) === 3600);

  const replay = await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, batch, tplRev, [{ payment_id: zoe.id, expected_version: vz, replace: false }, { payment_id: ella.id, expected_version: ve, replace: false }]));
  ok("submitting the same request again adds nothing", replay.ok === true && replay.duplicate === true && (await active(zoe.id)).length === 6 && (await allRows(zoe.id)).length === 6, replay);

  const again = await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: zoe.id, expected_version: await version(zoe.id), replace: false }]));
  ok("an existing schedule is kept unless replacement is chosen", again.ok === false && again.code === "not_eligible" && again.players[0].reason === "has_schedule" && (await allRows(zoe.id)).length === 6, again);
  const wrong = await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: odd.id, expected_version: await version(odd.id), replace: false }]));
  ok("a player whose total differs is refused", wrong.ok === false && wrong.players[0].reason === "total_differs", wrong);

  // whole request refused if one player changed
  const m1 = await player(3600), m2 = await player(3600);
  const v1 = await version(m1.id), v2 = await version(m2.id);
  await pay(m2.id, 100);
  const part = await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: m1.id, expected_version: v1, replace: false }, { payment_id: m2.id, expected_version: v2, replace: false }]));
  ok("one player changed: the whole request is refused and names them", part.ok === false && part.code === "changed" && part.players.length === 1 && (await active(m1.id)).length === 0, part);

  const rep = await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: zoe.id, expected_version: await version(zoe.id), replace: true }]));
  ok("replacement, when chosen, supersedes the old schedule and keeps it", rep.ok === true && (await active(zoe.id)).length === 6 && (await allRows(zoe.id)).length === 12 && (await allRows(zoe.id)).filter((r) => r.r === "replaced").length === 6);
  ok("a read-only role cannot apply", (await fn(sa2, parentCtx(""), "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: m1.id, expected_version: v1, replace: false }]))).code === "forbidden");
  ok("another organization cannot apply this schedule", (await fn(sa2, B, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: m1.id, expected_version: v1, replace: false }]))).code === "not_found");

  // -------------------------------------------------------------------------
  console.log("\nChanging one player: total, exemption and schedule together\n");
  const pz = await player(3600);
  await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: pz.id, expected_version: await version(pz.id), replace: false }]));
  await pay(pz.id, 1500);
  const half = [{ due_date: "2026-09-01", amount: 1800 }, { due_date: "2027-01-01", amount: 1800 }];
  let r = await fn(sa2, A, "save_player_dues", jsonParams(pz.id, await version(pz.id), 3600, false, half));
  ok("a custom 50/50 schedule saves", r.ok === true && (await active(pz.id)).length === 2, r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(pz.id, await version(pz.id), 3000, false, null));
  ok("changing only the total of a scheduled player is refused", r.ok === false && r.code === "schedule_total_mismatch", r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(pz.id, await version(pz.id), 3000, false, [{ due_date: "2026-09-01", amount: 1000 }, { due_date: "2027-01-01", amount: 1000 }]));
  ok("installments that do not add up to the total are refused", r.ok === false && r.code === "schedule_total_mismatch", r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(pz.id, await version(pz.id), 3000, false, [{ due_date: "2026-09-01", amount: 1500 }, { due_date: "2027-01-01", amount: 1500 }]));
  ok("total and schedule changed together: allowed", r.ok === true && Number((await sa.query("select initial_cost from public.player_payments where id=$1", [pz.id])).rows[0].initial_cost) === 3000, r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(pz.id, await version(pz.id), 1000, false, [{ due_date: "2026-09-01", amount: 1000 }]));
  ok("total below what is already paid is refused", r.ok === false && r.code === "below_paid", r);
  const before2 = JSON.stringify(await active(pz.id));
  r = await fn(sa2, A, "save_player_dues", jsonParams(pz.id, await version(pz.id), 3000, false, [{ due_date: "2026-09-01", amount: 1500 }, { due_date: "2027-01-01", amount: 1500 }]));
  ok("saving what is already there changes nothing and is safe to repeat", r.ok === true && r.unchanged === true && JSON.stringify(await active(pz.id)) === before2, r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(pz.id, "not-the-version", 3000, false, null));
  ok("a stale version is refused", r.ok === false && r.code === "changed", r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(pz.id, await version(pz.id), 0, true, null));
  ok("exempt with payments recorded is refused, and nothing is touched", r.ok === false && r.code === "exempt_with_payments" && (await active(pz.id)).length === 2, r);

  const px = await player(3600);
  await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: px.id, expected_version: await version(px.id), replace: false }]));
  r = await fn(sa2, A, "save_player_dues", jsonParams(px.id, await version(px.id), 0, true, null));
  const rowsX = await allRows(px.id);
  ok("exempt with no payments: allowed, schedule history preserved as superseded", r.ok === true && (await active(px.id)).length === 0 && rowsX.length === 6 && rowsX.every((x) => x.r === "exempt"), { r, rowsX });
  r = await fn(sa2, A, "save_player_dues", jsonParams(px.id, await version(px.id), 3600, false, null));
  ok("clearing exempt leaves the player with no schedule, history untouched", r.ok === true && (await active(px.id)).length === 0 && (await allRows(px.id)).length === 6, r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(px.id, await version(px.id), 3600, false, chris));
  ok("a new schedule can be set after that", r.ok === true && (await active(px.id)).length === 6 && (await allRows(px.id)).length === 12, r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(px.id, await version(px.id), 3600, false, []));
  ok("clearing a schedule keeps it as history (reason: cleared)", r.ok === true && (await active(px.id)).length === 0 && (await allRows(px.id)).filter((x) => x.r === "cleared").length === 6, r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(px.id, await version(px.id), 0, false, null));
  ok("zero dues with no schedule is allowed", r.ok === true, r);
  r = await fn(sa2, A, "save_player_dues", jsonParams(px.id, await version(px.id), 0, false, [{ due_date: "2026-09-01", amount: 5 }]));
  ok("zero dues with installments is refused", r.ok === false, r);

  // -------------------------------------------------------------------------
  console.log("\nThe database holds the line even without the functions\n");
  const pd = await player(3600);
  await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: pd.id, expected_version: await version(pd.id), replace: false }]));
  await sa.query("begin"); await sa.query("update public.player_payments set initial_cost=3000 where id=$1", [pd.id]);
  await rejects("changing only the total is refused at commit", sa.query("commit"), "23514"); await sa.query("rollback").catch(() => {});
  await sa.query("begin"); await sa.query("update public.player_payments set exempt=true, initial_cost=0 where id=$1", [pd.id]);
  await rejects("marking exempt while a schedule is active is refused at commit", sa.query("commit"), "23514"); await sa.query("rollback").catch(() => {});
  await sa.query("begin");
  await sa.query("update public.dues_installments set superseded_at=now(), superseded_reason='replaced' where payment_id=$1 and superseded_at is null and seq=6", [pd.id]);
  await rejects("removing one installment alone is refused at commit", sa.query("commit"), "23514"); await sa.query("rollback").catch(() => {});
  await sa.query("begin");
  await sa.query("insert into public.dues_installments(organization_id,season_id,payment_id,seq,due_date,amount) values ($1,$2,$3,7,'2027-03-01',10)", [orgA, seasonA, pd.id]);
  await rejects("adding an installment alone is refused at commit", sa.query("commit"), "23514"); await sa.query("rollback").catch(() => {});
  await sa.query("begin"); await sa.query("update public.player_payments set initial_cost=3000 where id=$1", [pd.id]);
  await sa.query("update public.dues_installments set superseded_at=now(), superseded_reason='replaced' where payment_id=$1 and superseded_at is null", [pd.id]);
  for (const [i, d, a] of [[1, "2026-09-01", 1500], [2, "2027-01-01", 1500]]) await sa.query("insert into public.dues_installments(organization_id,season_id,payment_id,seq,due_date,amount) values ($1,$2,$3,$4,$5,$6)", [orgA, seasonA, pd.id, i, d, a]);
  let committed = true; try { await sa.query("commit"); } catch { committed = false; }
  ok("both together in one transaction: allowed", committed && (await active(pd.id)).length === 2);
  await rejects("an installment cannot be edited", sa.query("update public.dues_installments set amount=1 where payment_id=$1 and seq=1 and superseded_at is null", [pd.id]), "42501");
  await rejects("schedule history cannot be deleted", sa.query("delete from public.dues_installments where payment_id=$1", [pd.id]), "42501");
  await rejects("a player with schedule history cannot be deleted", sa.query("delete from public.player_payments where id=$1", [pd.id]), "23503");
  await rejects("a replaced entry cannot be revived", sa.query("update public.dues_installments set superseded_at=null, superseded_reason=null where payment_id=$1 and superseded_at is not null", [px.id]), "42501");

  // -------------------------------------------------------------------------
  console.log("\nTable permissions\n");
  const pr = await player(3600); await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: pr.id, expected_version: await version(pr.id), replace: false }]));
  ok("staff in the organization can read installments", (await as(sa2, A, "select count(*)::int c from public.dues_installments where payment_id=$1", [pr.id]))[0].c === 6);
  ok("another organization sees nothing", (await as(sa2, B, "select count(*)::int c from public.dues_installments"))[0].c === 0);
  ok("another organization sees no team schedules", (await as(sa2, B, "select count(*)::int c from public.dues_schedule_templates"))[0].c === 0);
  ok("a parent not linked to the player sees nothing", (await as(sa2, parentCtx(""), "select count(*)::int c from public.dues_installments"))[0].c === 0);
  ok("a parent sees only their own player's schedule", (await as(sa2, parentCtx(pr.pid), "select count(*)::int c from public.dues_installments"))[0].c === 6);
  ok("a parent cannot read team schedules", (await as(sa2, parentCtx(pr.pid), "select count(*)::int c from public.dues_schedule_templates"))[0].c === 0);
  await rejects("a signed-in person cannot insert installments directly", as(sa2, A, "insert into public.dues_installments(organization_id,season_id,payment_id,seq,due_date,amount) values ($1,$2,$3,9,'2027-05-01',1)", [orgA, seasonA, pr.id]), "42501");
  await rejects("a signed-in person cannot change installments directly", as(sa2, A, "update public.dues_installments set amount=1"), "42501");
  await rejects("a signed-in person cannot delete installments directly", as(sa2, A, "delete from public.dues_installments"), "42501");
  await rejects("a signed-in person cannot write team schedules directly", as(sa2, A, "update public.dues_schedule_templates set name='x'"), "42501");
  ok("the internal version function is not callable by a signed-in person", await (async () => { try { await as(sa2, A, "select public.dues_state_version_raw($1)", [pr.id]); return false; } catch (e) { return e.code === "42501"; } })());
  ok("another organization gets no version for this player", (await fn(sa2, B, "dues_state_version", [pr.id])) === null);
  await rejects("a regular update of total by staff is still checked against the schedule", (async () => { await begin(sa2, A); try { await sa2.query("update public.player_payments set initial_cost=1 where id=$1", [pr.id]); await sa2.query("commit"); } catch (e) { await sa2.query("rollback"); throw e; } })(), "23514");

  // -------------------------------------------------------------------------
  console.log("\nSimultaneous work\n");
  // payment vs schedule edit
  const c1 = await player(3600); await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: c1.id, expected_version: await version(c1.id), replace: false }]));
  const vOpen = await version(c1.id);
  const cA = await connect(), cB = await connect();
  await begin(cA, A); await cA.query("select public.record_player_payment($1,$2,null,200,'2026-11-02',null)", [c1.id, uuid()]);
  await begin(cB, A); let bDone = false;
  const pB = cB.query("select public.save_player_dues($1,$2,3600,false,$3::jsonb) as r", [c1.id, vOpen, JSON.stringify(chris.slice(0, 5).concat([{ due_date: "2027-03-01", amount: 500 }]))]).then((x) => { bDone = true; return x; });
  await sleep(500);
  ok("a stale schedule edit waits while a payment is being saved", bDone === false);
  await cA.query("commit");
  const rB = (await pB).rows[0].r; await cB.query("rollback");
  ok("after the payment commits, the stale schedule edit is refused", rB.ok === false && rB.code === "changed", rB);
  ok("the schedule was not changed by the refused edit", (await active(c1.id)).at(-1).d === "2027-02-01");

  // schedule edit first, then payment form with stale expected paid
  const c2 = await player(3600); await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: c2.id, expected_version: await version(c2.id), replace: false }]));
  const v2a = await version(c2.id);
  await begin(cA, A); await cA.query("select public.save_player_dues($1,$2,3600,false,$3::jsonb)", [c2.id, v2a, JSON.stringify(chris.slice(0, 5).concat([{ due_date: "2027-03-01", amount: 500 }]))]);
  await begin(cB, A); bDone = false;
  const pB2 = cB.query("select public.record_player_payment($1,$2,0,300,'2026-11-03',null) as r", [c2.id, uuid()]).then((x) => { bDone = true; return x; });
  await sleep(400); ok("a payment waits while a schedule edit is being saved", bDone === false);
  await cA.query("commit"); const rP = (await pB2).rows[0].r; await cB.query("commit");
  ok("the payment then saves normally (a schedule change is not a payment change)", rP.ok === true, rP);

  // bulk apply vs payment
  const d1 = await player(3600), d2 = await player(3600);
  const vd1 = await version(d1.id), vd2 = await version(d2.id);
  await begin(cA, A); await cA.query("select public.record_player_payment($1,$2,null,50,'2026-11-02',null)", [d2.id, uuid()]);
  await begin(cB, A); bDone = false;
  const pB3 = cB.query("select public.apply_dues_schedule($1,$2,$3,$4::jsonb) as r", [tpl, uuid(), tplRev, JSON.stringify([{ payment_id: d1.id, expected_version: vd1, replace: false }, { payment_id: d2.id, expected_version: vd2, replace: false }])]).then((x) => { bDone = true; return x; });
  await sleep(400); ok("bulk apply waits for a payment in progress", bDone === false);
  await cA.query("commit"); const rBulk = (await pB3).rows[0].r; await cB.query("rollback");
  ok("then refuses everything, naming the player who changed", rBulk.ok === false && rBulk.code === "changed" && rBulk.players.length === 1 && (await active(d1.id)).length === 0 && (await active(d2.id)).length === 0, rBulk);

  // two schedule edits with the same version
  const e1 = await player(3600); await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: e1.id, expected_version: await version(e1.id), replace: false }]));
  const ve1 = await version(e1.id);
  const mk = (c) => c.query("select public.save_player_dues($1,$2,3600,false,$3::jsonb) as r", [e1.id, ve1, JSON.stringify([{ due_date: "2026-10-01", amount: 1800 }, { due_date: "2026-12-01", amount: 1800 }])]);
  await begin(cA, A); await begin(cB, A);
  const [ra, rb] = await Promise.all([mk(cA).then(async (x) => { await cA.query("commit"); return x; }), sleep(100).then(() => mk(cB)).then(async (x) => { await cB.query("rollback"); return x; })]);
  const codes = [ra.rows[0].r.ok, rb.rows[0].r.ok].sort();
  ok("two edits from the same screen: one wins, the other is refused", JSON.stringify(codes) === "[false,true]", [ra.rows[0].r, rb.rows[0].r]);
  ok("history shows exactly one replacement", (await allRows(e1.id)).filter((x) => x.r === "replaced").length === 6 && (await active(e1.id)).length === 2);

  // same bulk request sent twice at once
  const f1 = await player(3600), f2 = await player(3600);
  const body = JSON.stringify([{ payment_id: f1.id, expected_version: await version(f1.id), replace: false }, { payment_id: f2.id, expected_version: await version(f2.id), replace: false }]);
  const key = uuid();
  await begin(cA, A); await begin(cB, A);
  const [ga, gb] = await Promise.all([cA.query("select public.apply_dues_schedule($1,$2,$3,$4::jsonb) as r", [tpl, key, tplRev, body]), cB.query("select public.apply_dues_schedule($1,$2,$3,$4::jsonb) as r", [tpl, key, tplRev, body])].map((p, i) => p.then(async (x) => { await (i ? cB : cA).query("commit"); return x; })));
  const dups = [ga.rows[0].r.duplicate, gb.rows[0].r.duplicate].sort();
  ok("the same request sent twice at once applies once", JSON.stringify(dups) === "[false,true]" && (await active(f1.id)).length === 6 && (await allRows(f1.id)).length === 6 && (await active(f2.id)).length === 6, [ga.rows[0].r, gb.rows[0].r]);

  // undo
  const u1 = await player(3600); await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, [{ payment_id: u1.id, expected_version: await version(u1.id), replace: false }]));
  const p1 = await pay(u1.id, 400);
  await fn(sa2, A, "save_player_dues", jsonParams(u1.id, await version(u1.id), 3600, false, [{ due_date: "2026-10-01", amount: 1800 }, { due_date: "2026-12-01", amount: 1800 }]));
  const undo1 = await fn(sa2, A, "undo_player_payment", [p1.operation_id]);
  ok("undo still works after the schedule was changed", undo1.ok === true && (await logState(u1.id)).c === 0, undo1);
  const u2 = await player(3600); const p2 = await pay(u2.id, 400);
  await fn(sa2, A, "save_player_dues", jsonParams(u2.id, await version(u2.id), 3500, false, null));
  const undo2 = await fn(sa2, A, "undo_player_payment", [p2.operation_id]);
  ok("undo is still refused after the total changed", undo2.ok === false && undo2.code === "changed_since", undo2);
  const u3 = await player(3600); const p3 = await pay(u3.id, 400); await pay(u3.id, 100);
  const undo3 = await fn(sa2, A, "undo_player_payment", [p3.operation_id]);
  ok("undo is still refused after a later payment", undo3.ok === false && undo3.code === "changed_since", undo3);


  // -------------------------------------------------------------------------
  console.log("\nTeam schedule changed after the preview (reviewed revision)\n");
  const tx = (await fn(sa2, A, "save_dues_template", jsonParams(seasonA, null, null, "Review copy", chris, false)));
  const revNow = async () => (await sa.query("select revision from public.dues_schedule_templates where id=$1", [tx.id])).rows[0].revision;
  const pvx = (id) => fn(sa2, A, "preview_dues_schedule", [tx.id, [id]]);
  const g1 = await player(3600);
  const g1pv = await pvx(g1.id);
  ok("preview returns the revision that was reviewed", g1pv.revision === 1 && g1pv.items.length === 6, g1pv.revision);
  const gEntry = (id, v) => [{ payment_id: id, expected_version: v, replace: false }];
  const noRev = await fn(sa2, A, "apply_dues_schedule", jsonParams(tx.id, uuid(), null, gEntry(g1.id, g1pv.players[0].version)));
  ok("apply without a reviewed revision is refused", noRev.ok === false && noRev.code === "invalid" && (await active(g1.id)).length === 0, noRev);

  // edited after the review, sequentially
  await fn(sa2, A, "save_dues_template", jsonParams(seasonA, tx.id, 1, "Review copy", chris.map((c, i) => (i === 1 ? { ...c, amount: 400 } : i === 2 ? { ...c, amount: 600 } : c)), false));
  const staleApply = await fn(sa2, A, "apply_dues_schedule", jsonParams(tx.id, uuid(), 1, gEntry(g1.id, g1pv.players[0].version)));
  ok("apply of an older review is refused and nothing is written", staleApply.ok === false && staleApply.code === "template_changed" && staleApply.revision === 2 && (await active(g1.id)).length === 0, staleApply);

  // edit lands while the apply is waiting on / holding the schedule
  const g2 = await player(3600), g2pv = await pvx(g2.id); // reviewed at revision 2
  await begin(cA, A);
  await cA.query("select public.save_dues_template($1,$2,$3,$4,$5::jsonb,false)", [seasonA, tx.id, 2, "Review copy", JSON.stringify(chris.map((c, i) => (i === 0 ? { ...c, amount: 1000 } : i === 1 ? { ...c, amount: 600 } : c)))]);
  await begin(cB, A); bDone = false;
  const pApply = cB.query("select public.apply_dues_schedule($1,$2,$3,$4::jsonb) as r", [tx.id, uuid(), g2pv.revision, JSON.stringify(gEntry(g2.id, g2pv.players[0].version))]).then((x) => { bDone = true; return x; });
  await sleep(400); ok("apply waits for a schedule edit that is in progress", bDone === false);
  await cA.query("commit"); const rApply = (await pApply).rows[0].r; await cB.query("rollback");
  ok("then refuses: the schedule that was reviewed is not the one that exists", rApply.ok === false && rApply.code === "template_changed" && (await active(g2.id)).length === 0, rApply);

  // apply holds the schedule while an edit tries to change it
  const g3 = await player(3600), g3pv = await pvx(g3.id);
  const reviewedItems = g3pv.items.map((i) => `${i.due_date}:${Number(i.amount)}`).join();
  await begin(cA, A);
  const rA = await cA.query("select public.apply_dues_schedule($1,$2,$3,$4::jsonb) as r", [tx.id, uuid(), g3pv.revision, JSON.stringify(gEntry(g3.id, g3pv.players[0].version))]);
  await begin(cB, A); bDone = false;
  const pEdit = cB.query("select public.save_dues_template($1,$2,$3,$4,$5::jsonb,false) as r", [seasonA, tx.id, g3pv.revision, "Review copy", JSON.stringify(chris.slice(0, 3))]).then((x) => { bDone = true; return x; });
  await sleep(400); ok("a schedule edit waits while an apply is using the schedule", bDone === false);
  await cA.query("commit"); const rEdit = (await pEdit).rows[0].r; await cB.query("commit");
  const got = (await active(g3.id)).map((r) => `${r.d}:${r.a}`).join();
  ok("the player received exactly the reviewed dates and amounts", rA.rows[0].r.ok === true && got === reviewedItems, { got, reviewedItems });
  ok("the later edit then applies on top (new revision), unaffected players keep what they got", rEdit.ok === true && rEdit.revision === g3pv.revision + 1);

  // a repeat of an earlier request still reports itself, even if the schedule has moved on
  await fn(sa2, A, "save_dues_template", jsonParams(seasonA, tx.id, await revNow(), "Review copy", chris, false)); // back to Chris's schedule
  const g4 = await player(3600), g4pv = await pvx(g4.id), k4 = uuid();
  const first = await fn(sa2, A, "apply_dues_schedule", jsonParams(tx.id, k4, g4pv.revision, gEntry(g4.id, g4pv.players[0].version)));
  await fn(sa2, A, "save_dues_template", jsonParams(seasonA, tx.id, await revNow(), "Review copy", chris, false));
  const again4 = await fn(sa2, A, "apply_dues_schedule", jsonParams(tx.id, k4, g4pv.revision, gEntry(g4.id, g4pv.players[0].version)));
  ok("a repeated request is reported as already applied, not as a stale review", first.ok === true && again4.ok === true && again4.duplicate === true && (await active(g4.id)).length === 6, again4);
  ok("a read-only role still cannot apply (revision supplied)", (await fn(sa2, parentCtx(""), "apply_dues_schedule", jsonParams(tx.id, uuid(), 1, gEntry(g4.id, "x")))).code === "forbidden");

  // -------------------------------------------------------------------------
  console.log("\nPlayer editor: one snapshot, values and version together\n");
  const sn = await player(3600); await fn(sa2, A, "apply_dues_schedule", jsonParams(tpl, uuid(), tplRev, gEntry(sn.id, await version(sn.id))));
  await pay(sn.id, 700, "2026-09-03");
  const s1 = await fn(sa2, A, "dues_player_snapshot", [sn.id]);
  ok("snapshot carries total, exempt, paid, the active schedule and the version", s1.ok === true && Number(s1.total) === 3600 && s1.exempt === false && Number(s1.paid) === 700 && s1.installments.length === 6 && s1.installments[0].amount === 1100, s1);
  ok("the version in the snapshot is the version of exactly those values", s1.version === (await version(sn.id)));
  ok("the snapshot is a STABLE function (one snapshot for every read inside it)", (await sa.query("select provolatile v from pg_proc where proname='dues_player_snapshot'")).rows[0].v === "s");
  // the page was loaded before this payment; the editor opens after it
  const pageVersion = s1.version;
  await pay(sn.id, 200, "2026-10-04");
  const s2 = await fn(sa2, A, "dues_player_snapshot", [sn.id]);
  ok("opening the editor after a change shows the new payments and the new version together", Number(s2.paid) === 900 && s2.version !== pageVersion && s2.version === (await version(sn.id)), { paid: s2.paid });
  const oldSave = await fn(sa2, A, "save_player_dues", jsonParams(sn.id, pageVersion, 3600, false, null));
  ok("a save carrying the older version is refused", oldSave.ok === false && oldSave.code === "changed", oldSave);
  const newSave = await fn(sa2, A, "save_player_dues", jsonParams(sn.id, s2.version, 3700, false, [{ due_date: "2026-09-01", amount: 1200 }, { due_date: "2026-10-01", amount: 2500 }]));
  ok("a save carrying the snapshot's own version goes through", newSave.ok === true, newSave);
  // payment lands between opening the editor and saving
  const s3 = await fn(sa2, A, "dues_player_snapshot", [sn.id]);
  await pay(sn.id, 50, "2026-11-02");
  const raced = await fn(sa2, A, "save_player_dues", jsonParams(sn.id, s3.version, 3700, false, null));
  ok("a payment recorded after the editor opened refuses the save", raced.ok === false && raced.code === "changed", raced);
  ok("snapshot: a read-only role is refused", (await fn(sa2, parentCtx(""), "dues_player_snapshot", [sn.id])).code === "forbidden");
  ok("snapshot: another organization sees nothing", (await fn(sa2, B, "dues_player_snapshot", [sn.id])).code === "not_found");
  const sx = await player(0, { exempt: true });
  const sxs = await fn(sa2, A, "dues_player_snapshot", [sx.id]);
  ok("snapshot of an exempt player: exempt, no schedule", sxs.ok && sxs.exempt === true && sxs.installments.length === 0, sxs);

  for (const c of [cA, cB, sa2]) await c.end();
  await sa.end();
  console.log(`\n${ran - failed}/${ran} passed${failed ? `, ${failed} FAILED` : ""}\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("dues-db-test crashed:", e); process.exit(1); });
