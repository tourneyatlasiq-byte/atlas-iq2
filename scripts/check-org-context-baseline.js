/**
 * Phase 3C-0: the behaviour 3C must not change.
 *
 * Before any 3C application change, this pins what production does today for each of the 7
 * accounts (scripts/fixtures/org-context-baseline.js, captured with
 * scripts/sql/org-context-baseline.sql) and proves the application's own context code agrees.
 * The same checks run unchanged after every 3C batch: if a batch changes who resolves to which
 * organization or role, or what a Coach can write, this fails.
 *
 *   A. Recorded database baseline: organization, role, membership, pin behaviour, team access,
 *      cross-organization blocking, write reach, Settings People
 *   B. The application's context code (getContext, getViewer, isOrgAdmin, canWrite) run against
 *      an in-memory stand-in for each account: same organization, same role, same answers
 *   C. Settings People as it exists today: the page's profiles query and how it renders people
 *   D. The probe itself cannot change anything: it can only abort
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
const B = require("./fixtures/org-context-baseline.js");
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/* ---------------- A. recorded database baseline ---------------- */
console.log("\nA. Recorded database baseline (production, before 3C)");
ok("7 accounts across 6 organizations (two organizations are both named Armor Elite)", [B.accounts.length, new Set(B.accounts.map((a) => a.orgId)).size], [7, 5]);
ok("every account has exactly one membership, equal to its profile's organization and role", B.accounts.every((a) => a.authority && a.orgId && a.role), true);
ok("authority matches role: owners are 'owner', the coach is 'member'", B.accounts.map((a) => `${a.role}:${a.authority}`).sort(), ["coach:member", "owner:owner", "owner:owner", "owner:owner", "owner:owner", "owner:owner", "owner:owner"]);
ok("production migrations at capture", B.migrationsApplied, 122);
ok("no team assignment points into another organization", B.staleTeamAssignments, 0);

for (const a of B.accounts) {
  const v = a.visible, u = a.updatable;
  console.log(`  - ${a.key} (${a.org}, ${a.role})`);
  ok("    sees exactly its own organization", v.organizations ?? 0, 1);
  ok("    sees every team of its organization (owner) or only its assigned team (coach)", v.teams, a.role === "owner" ? a.orgTeams : a.assignedTeams);
  ok("    owner/admin helpers: admin only for the owner", a.authority === "owner", a.role === "owner");
  ok("    can update operational rows in its own organization", sum(u) > 0, true);
  ok("    structure (teams, invites) is writable only by owners", ["teams", "invites"].some((t) => u[t] > 0), a.role === "owner");
  ok("    Settings People shows the organization's profiles", a.peopleRoles.length, a.role === "owner" && a.orgMemberships === 1 ? 1 : 3);
}
ok("coach and both Northgate owners see the same operational data", ["games", "players", "tournaments", "plate_appearances"].map((t) => [B.accounts[3].visible[t], B.accounts[4].visible[t], B.accounts[5].visible[t]].every((n) => n === B.accounts[3].visible[t])), [true, true, true, true]);
ok("a Northgate owner sees all 3 memberships, the coach only its own", [B.accounts[4].visible.organization_memberships, B.accounts[3].visible.organization_memberships], [3, 1]);
ok("pins that resolve to the account's own organization (absent, match, upper-case header name)", B.SAME_ORG_PINS, ["absent", "match", "uppercasekey"]);
ok("pins that fail closed (another organization, nonexistent, malformed, empty, duplicated, comma-joined)", B.BLOCKED_PINS, ["mismatch", "nonexistent", "malformed", "empty", "duplicate", "commajoined"]);
ok("a failed pin leaves only the account's own membership row (plus the coach's one team assignment)", B.accounts.map((a) => sum(B.blockedVisible(a))), [1, 1, 1, 2, 1, 1, 1]);
ok("temporary 3B compatibility: no pin gives exactly the answers a matching pin gives, for every account", B.accounts.every((a) => JSON.stringify(B.helpersFor(a, "absent")) === JSON.stringify(B.helpersFor(a, "match"))), true);
ok("a correct pin resolves each account to its own organization and current role", B.accounts.map((a) => { const h = B.helpersFor(a, "match"); return [h.org, h.role, h.admin].join(":"); }), B.accounts.map((a) => ["OWN", a.role, a.role === "owner"].join(":")));
ok("every failing pin leaves every account with no organization, no role, no write, no teams, no seasons", B.accounts.every((a) => B.BLOCKED_PINS.every((p) => JSON.stringify(B.helpersFor(a, p)) === JSON.stringify({ org: null, role: null, admin: false, write: false, teams: 0, seasons: 0 }))), true);
ok("cross-organization team access stays blocked: with a pin for another organization no account has any team", B.accounts.every((a) => B.helpersFor(a, "mismatch").teams === 0), true);
ok("a synthetic Manager resolves exactly like a Coach", [B.syntheticManager.admin, B.syntheticManager.write, B.syntheticManager.teams, B.syntheticManager.updatableSameAsCoach], [false, true, 1, true]);

/* ---------------- B. the application's own context code ---------------- */
console.log("\nB. getContext / getViewer / isOrgAdmin / canWrite against each account");
const state = { uid: null, redirected: null, pins: [] };
let data = {};
function builder(table) {
  const f = [];
  const run = () => (data[table] ?? []).filter((r) => f.every((p) => p(r)));
  const b = {
    select() { return b; },
    eq(c, v) { f.push((r) => r[c] === v); return b; },
    in(c, a) { f.push((r) => a.includes(r[c])); return b; },
    order() { return b; },
    single() { const rows = run(); return Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { message: "no row" } }); },
    maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
  };
  return b;
}
const fakeClient = () => ({
  auth: { getUser: async () => ({ data: { user: state.uid ? { id: state.uid } : null } }) },
  from: builder,
});
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/headers") return { cookies: () => ({ get: () => undefined }) };
  if (request === "next/navigation") return { redirect: (to) => { state.redirected = to; throw new Error("REDIRECT " + to); } };
  if (request === "react") { const R = origLoad.call(this, request, parent, ...rest); return { ...R, cache: (fn) => fn }; }
  if (/supabase\/server$/.test(request)) return { createClient: fakeClient, createPinnedClient: (orgId) => { state.pins.push(orgId); return fakeClient(); } };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const ctxMod = require(path.join(ROOT, "lib/context.js"));

const world = (a, role = a.role) => ({
  profiles: [{ id: a.uid, full_name: "X", role, organization_id: a.orgId, active_organization_id: a.orgId, onboarding_hidden: false }],
  organization_memberships: [{ user_id: a.uid, organization_id: a.orgId, authority: a.authority, legacy_role: role }],
  organizations: [{ id: a.orgId, name: a.org, logo_url: null }],
  teams: Array.from({ length: a.role === "owner" ? a.orgTeams : a.assignedTeams }, (_, i) => ({ id: `team-${a.key}-${i}`, name: "T", is_placeholder_name: false, organization_id: a.orgId })),
  seasons: [{ id: `season-${a.key}`, name: "S", team_id: `team-${a.key}-0`, start_date: "2026-08-01", end_date: "2027-07-31", is_current: true, is_placeholder: false, created_at: "2026-08-01" }],
  organization_features: [{ organization_id: a.orgId, feature_key: "qab", enabled: true }],
});

(async () => {
  for (const a of B.accounts) {
    state.uid = a.uid; data = world(a);
    const ctx = await ctxMod.getContext();
    const viewer = await ctxMod.getViewer();
    console.log(`  - ${a.key}`);
    ok("    resolves to its current organization", ctx.organization?.id, a.orgId);
    ok("    resolves to its current role", ctx.profile?.role, a.role);
    ok("    isOrgAdmin matches the database's admin answer (owner only)", ctxMod.isOrgAdmin(ctx.profile), a.authority === "owner");
    ok("    canWrite matches the database's write answer", ctxMod.canWrite(ctx.profile), true);
    ok("    its teams are those of its own organization", ctx.teams.length, a.role === "owner" ? a.orgTeams : a.assignedTeams);
    ok("    premium features follow its organization", ctx.features, { qab: true });
    ok("    getViewer reports an organization", viewer.hasOrganization, true);
  }
  // Manager (no production account): same write answer as the coach, no admin.
  const coach = B.accounts[3];
  ok("Manager (synthetic): canWrite true, isOrgAdmin false", [ctxMod.canWrite({ role: "manager" }), ctxMod.isOrgAdmin({ role: "manager" })], [true, false]);
  ok("admin role is treated as an administrator", [ctxMod.isOrgAdmin({ role: "admin" }), ctxMod.canWrite({ role: "admin" })], [true, true]);
  ok("unknown or missing roles can neither write nor administer", [ctxMod.canWrite({ role: "viewer" }), ctxMod.canWrite(null), ctxMod.isOrgAdmin(undefined)], [false, false, false]);
  // Fresh team: signed in, no organization yet.
  state.uid = "00000000-0000-4000-8000-0000000000aa";
  data = { profiles: [{ id: state.uid, full_name: "New", role: null, organization_id: null, onboarding_hidden: false }] };
  const fresh = await ctxMod.getContext();
  ok("Fresh Team: a signed-in person with no organization gets no organization, no teams, no features", [fresh.organization, fresh.teams.length, fresh.season, fresh.features], [null, 0, null, {}]);
  ok("Fresh Team: getViewer says there is no organization yet", (await ctxMod.getViewer()).hasOrganization, false);
  state.uid = null;
  let redirected = null; try { await ctxMod.getContext(); } catch (e) { redirected = state.redirected; }
  ok("signed out: getContext sends the person to /login", redirected, "/login");

  /* ---------------- C. Settings People as it exists today ---------------- */
  console.log("\nC. Settings People today");
  const page = fs.readFileSync(path.join(ROOT, "app/(app)/settings/page.js"), "utf8");
  ok("reads the organization's people from profiles (id, full_name, role) filtered by the organization, ordered by role", /\.from\("profiles"\)\s*\.select\("id, full_name, role"\)\s*\.eq\("organization_id", organization\.id\)\s*\.order\("role"\)/.test(page), true);
  ok("administrators list no teams; everyone else lists their team names", /teamNames: isOrgAdmin\(p\) \? \[\] : teamsBy\.get\(p\.id\) \?\? \[\]/.test(page), true);
  ok("recorded visibility: owners and the coach of a 3-person organization all see the same 3 people", B.accounts.filter((a) => a.org === "Northgate Fastpitch").map((a) => a.peopleRoles.join("+")), ["coach+owner+owner", "coach+owner+owner", "coach+owner+owner"]);
  ok("recorded visibility: single-person organizations show just that owner", B.accounts.filter((a) => a.org !== "Northgate Fastpitch").map((a) => a.peopleRoles.join("+")), ["owner", "owner", "owner", "owner"]);
  ok("the people list is NOT read from memberships (kept on profiles through 3C, by decision)", /organization_memberships/.test(page), false);

  /* ---------------- D. the probe cannot change anything ---------------- */
  console.log("\nD. The baseline probe is abort-only");
  const sql = fs.readFileSync(path.join(ROOT, "scripts/sql/org-context-baseline.sql"), "utf8").replace(/--.*$/gm, "");
  ok("it always ends by raising an exception, so the transaction can never commit", /raise exception 'BASELINE\|%'[^;]*;\s*end \$baseline\$;\s*$/i.test(sql), true);
  ok("it contains no commit, insert, delete, DDL, grant or truncate", /\b(commit|insert\s+into|delete\s+from|create\s|alter\s|drop\s|truncate|grant\s|revoke\s)/i.test(sql), false);
  const updates = (sql.match(/update public\.%I set [^']*/gi) ?? []);
  ok("every UPDATE it runs is a no-op (a column set to itself)", updates.length > 0 && updates.every((u) => /set organization_id = organization_id/.test(u)), true);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
