/**
 * Phase 3C-1: the pinned client, the narrow bootstrap and the membership-based context.
 *
 *   A. createPinnedClient: sends the pin header, rejects anything that is not an organization id
 *   B. Bootstrap: unpinned, own rows only, three reads, returns facts and never a client
 *   C. getContext: the organization comes from the live membership; every organization-scoped
 *      read goes through the pinned client with that organization; an inconsistent account fails closed
 *   D. Parity with the 3C-0 baseline for all 7 accounts: same organization, role, teams, season, features
 *   E. Nothing outside the context path has moved (3C-2 does that)
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

const log = [];          // every query: { client: "unpinned" | "pinned:<org>", table, columns }
const state = { uid: null, redirected: null };
let data = {};
function builder(client, table) {
  const f = []; let cols = null;
  const run = () => (data[table] ?? []).filter((r) => f.every((p) => p(r))).map((r) => (cols ? Object.fromEntries(cols.split(",").map((c) => c.trim()).filter((c) => c in r).map((c) => [c, r[c]])) : r));
  const rec = () => log.push({ client, table, columns: cols });
  const b = {
    select(c) { cols = c; return b; },
    eq(c, v) { f.push((r) => r[c] === v); return b; },
    in(c, a) { f.push((r) => a.includes(r[c])); return b; },
    order() { return b; },
    single() { rec(); const rows = run(); return Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { message: "no row" } }); },
    maybeSingle() { rec(); return Promise.resolve({ data: run()[0] ?? null, error: null }); },
    then(res, rej) { rec(); return Promise.resolve({ data: run(), error: null }).then(res, rej); },
  };
  return b;
}
const fake = (client) => ({
  auth: { getUser: async () => ({ data: { user: state.uid ? { id: state.uid } : null } }) },
  from: (t) => builder(client, t),
});
let ssrCalls = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/headers") return { cookies: () => ({ get: () => undefined, getAll: () => [], set() {} }) };
  if (request === "next/navigation") return { redirect: (to) => { state.redirected = to; throw new Error("REDIRECT " + to); } };
  if (request === "react") { const R = origLoad.call(this, request, parent, ...rest); return { ...R, cache: (fn) => fn }; }
  if (request === "@supabase/ssr") return { createServerClient: (url, key, opts) => { ssrCalls.push(opts); return {}; } };
  if (/supabase\/server$/.test(request) && !state.realServer) {
    return {
      createClient: () => fake("unpinned"),
      createPinnedClient: (orgId) => fake("pinned:" + orgId),
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};

(async () => {
  /* ---------------- A. createPinnedClient ---------------- */
  console.log("\nA. createPinnedClient");
  state.realServer = true;
  const server = require(path.join(ROOT, "lib/supabase/server.js"));
  state.realServer = false;
  const ORG = "4945AA3A-887F-4932-A886-C0527ABED80D";
  ssrCalls = []; server.createPinnedClient(ORG);
  ok("sends x-season-tempo-org with the organization id (lower-cased)", ssrCalls[0].global.headers, { "x-season-tempo-org": ORG.toLowerCase() });
  ok("the header name matches the one the database reads", server.ORG_PIN_HEADER, "x-season-tempo-org");
  ssrCalls = []; server.createClient();
  ok("createClient() is unchanged: no global headers, so no pin (3B compatibility)", ["global" in ssrCalls[0], Object.keys(ssrCalls[0])], [false, ["cookies"]]);
  for (const bad of [undefined, null, "", "not-a-uuid", "a,b", `${ORG}, ${ORG}`, 42, " " + ORG, ORG + "\n"]) {
    let threw = false; try { server.createPinnedClient(bad); } catch { threw = true; }
    ok(`rejects ${JSON.stringify(bad)}`, threw, true);
  }

  const ctxMod = require(path.join(ROOT, "lib/context.js"));
  const boot = require(path.join(ROOT, "lib/auth/active-membership.js"));
  const world = (a, over = {}) => ({
    profiles: [{ id: a.uid, full_name: "X", role: a.role, organization_id: a.orgId, active_organization_id: a.orgId, onboarding_hidden: false }],
    organization_memberships: [{ user_id: a.uid, organization_id: a.orgId, authority: a.authority, legacy_role: a.role }],
    organizations: [{ id: a.orgId, name: a.org, logo_url: null }],
    teams: Array.from({ length: a.role === "owner" ? a.orgTeams : a.assignedTeams }, (_, i) => ({ id: `team-${a.key}-${i}`, name: "T", is_placeholder_name: false, organization_id: a.orgId })),
    seasons: [{ id: `season-${a.key}`, name: "S", team_id: `team-${a.key}-0`, start_date: "2026-08-01", end_date: "2027-07-31", is_current: true, is_placeholder: false, created_at: "2026-08-01" }],
    organization_features: [{ organization_id: a.orgId, feature_key: "qab", enabled: true }],
    ...over,
  });
  const owner = B.accounts[0], coach = B.accounts[3];

  /* ---------------- B. the bootstrap ---------------- */
  console.log("\nB. Bootstrap");
  state.uid = owner.uid; data = world(owner); log.length = 0;
  const r = await boot.resolveActiveMembership();
  ok("reads only profiles and organization_memberships, both unpinned", log.map((l) => `${l.client === "unpinned" ? "unpinned" : "PINNED"}:${l.table}`), ["unpinned:profiles", "unpinned:organization_memberships"]);
  ok("profile read is identity + active-organization pointer only (no role, no organization_id)", log[0].columns, "id, full_name, onboarding_hidden, active_organization_id");
  ok("membership read is the organization, authority and role only", log[1].columns, "organization_id, authority, legacy_role");
  ok("returns facts only: user, identity, membership; no client or function", [Object.keys(r).sort(), Object.values(r).some((v) => typeof v === "function")], [["membership", "profile", "user"], false]);
  ok("the membership is the one named by the pointer, for this user", r.membership, { organization_id: owner.orgId, authority: "owner", legacy_role: "owner" });
  ok("the returned profile carries no role or organization", Object.keys(r.profile).sort(), ["full_name", "id", "onboarding_hidden"]);
  data = world(owner, { profiles: [{ id: owner.uid, full_name: "N", active_organization_id: null, onboarding_hidden: false }] });
  ok("no pointer: signed in, no membership", (await boot.resolveActiveMembership()).membership, null);
  state.uid = null;
  ok("signed out: nothing is read after the auth check", [(await boot.resolveActiveMembership()).user, log.length], [null, 2 + 1]);
  state.uid = owner.uid;
  // pointer names an organization the user has no membership in: another organization's id, or a deleted membership
  data = world(owner, { profiles: [{ id: owner.uid, full_name: "X", active_organization_id: coach.orgId, onboarding_hidden: false }] });
  let err = null; try { await boot.resolveActiveMembership(); } catch (e) { err = e.message; }
  ok("a pointer with no live membership in that organization fails closed with an error", /could not be verified/.test(err ?? ""), true);
  data = world(owner, { organization_memberships: [{ user_id: coach.uid, organization_id: owner.orgId, authority: "owner", legacy_role: "owner" }] });
  err = null; try { await boot.resolveActiveMembership(); } catch (e) { err = e.message; }
  ok("another person's membership in the same organization does not count", /could not be verified/.test(err ?? ""), true);

  /* ---------------- C. getContext ---------------- */
  console.log("\nC. getContext");
  for (const a of B.accounts) {
    state.uid = a.uid; data = world(a); log.length = 0;
    const ctx = await ctxMod.getContext();
    const tag = `    ${a.key}`;
    const unpinned = log.filter((l) => l.client === "unpinned").map((l) => l.table);
    const pinned = [...new Set(log.filter((l) => l.client !== "unpinned").map((l) => l.client))];
    ok(`${tag}: unpinned reads are only the bootstrap`, unpinned, ["profiles", "organization_memberships"]);
    ok(`${tag}: every organization-scoped read is pinned to its own organization`, [pinned, log.filter((l) => l.client !== "unpinned").map((l) => l.table)], [[`pinned:${a.orgId}`], ["organizations", "teams", "seasons", "organization_features"].filter((t) => t !== "seasons" || ctx.teams.length)]);
  }
  state.uid = owner.uid; data = world(owner);
  // the role comes from the membership, not the profile: make them disagree
  data = world(owner, { profiles: [{ id: owner.uid, full_name: "X", role: "owner", organization_id: owner.orgId, active_organization_id: owner.orgId, onboarding_hidden: false }], organization_memberships: [{ user_id: owner.uid, organization_id: owner.orgId, authority: "member", legacy_role: "coach" }] });
  ok("role is taken from the membership (profile.role is not read)", (await ctxMod.getContext()).profile.role, "coach");
  data = world(owner, { profiles: [{ id: owner.uid, full_name: "X", role: "owner", organization_id: coach.orgId, active_organization_id: owner.orgId, onboarding_hidden: false }] });
  ok("organization is taken from the membership (profile.organization_id is not read)", (await ctxMod.getContext()).organization.id, owner.orgId);
  data = world(owner, { profiles: [{ id: owner.uid, full_name: "X", role: "owner", organization_id: owner.orgId, active_organization_id: coach.orgId, onboarding_hidden: false }] });
  let threw = null; try { await ctxMod.getContext(); } catch (e) { threw = e.message; }
  ok("getContext fails closed (error, not an empty or wrong context) when the pointer has no membership", /could not be verified/.test(threw ?? ""), true);
  ok("getViewer fails closed the same way", await ctxMod.getViewer().then(() => false, () => true), true);
  state.uid = "00000000-0000-4000-8000-0000000000aa";
  data = { profiles: [{ id: state.uid, full_name: "New", active_organization_id: null, onboarding_hidden: false }] };
  const fresh = await ctxMod.getContext();
  ok("Fresh Team: no organization, no role (writes stay off until a membership exists), shape preserved", [fresh.organization, fresh.membership, fresh.profile.role, fresh.profile.organization_id, fresh.teams, fresh.season, fresh.features], [null, null, null, null, [], null, {}]);

  /* ---------------- D. parity with the 3C-0 baseline ---------------- */
  console.log("\nD. Parity with the 3C-0 baseline (all 7 accounts, plus a synthetic Manager)");
  for (const a of B.accounts) {
    const legacy = (() => { // what the application resolved before 3C, from the same stand-in data
      const w = world(a), p = w.profiles[0];
      const teams = w.teams.filter((t) => t.organization_id === p.organization_id).map((t) => t.id);
      const seasons = w.seasons.filter((s) => teams.includes(s.team_id));
      const season = seasons.find((s) => s.is_current) ?? seasons[0] ?? null;
      return { org: p.organization_id, role: p.role, name: w.organizations[0].name, teams, season: season?.id ?? null, team: season?.team_id ?? teams[0] ?? null, features: { qab: true }, admin: p.role === "owner" || p.role === "admin", write: ["owner", "admin", "coach", "manager"].includes(p.role) };
    })();
    state.uid = a.uid; data = world(a);
    const c = await ctxMod.getContext(), v = await ctxMod.getViewer();
    const now = { org: c.organization.id, role: c.profile.role, name: c.organization.name, teams: c.teams.map((t) => t.id), season: c.season?.id ?? null, team: c.team?.id ?? null, features: c.features, admin: ctxMod.isOrgAdmin(c.profile), write: ctxMod.canWrite(c.profile) };
    ok(`    ${a.key}: organization, role, teams, season, features, admin and write are identical to the pre-3C resolution`, now, legacy);
    ok(`    ${a.key}: matches the recorded database baseline (organization, role, admin, team count)`, [c.organization.id, c.profile.role, ctxMod.isOrgAdmin(c.profile), c.teams.length, v.hasOrganization], [a.orgId, a.role, a.authority === "owner", a.role === "owner" ? a.orgTeams : a.assignedTeams, true]);
    ok(`    ${a.key}: user, profile identity and onboarding flag preserved`, [c.user.id, c.profile.id, c.profile.full_name, c.profile.onboarding_hidden, c.profile.organization_id], [a.uid, a.uid, "X", false, a.orgId]);
  }
  const mgr = world(coach); mgr.organization_memberships[0].legacy_role = "manager"; state.uid = coach.uid; data = mgr;
  const m = await ctxMod.getContext();
  ok("Manager (synthetic): resolves like a Coach: writes, no admin, own team", [ctxMod.canWrite(m.profile), ctxMod.isOrgAdmin(m.profile), m.teams.length], [true, false, 1]);

  /* ---------------- E. nothing else has moved ---------------- */
  console.log("\nE. Scope: 3C-1 touches the context path only");
  const files = []; (function walk(d) { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const rel = d + "/" + e.name; if (e.isDirectory()) { if (!["node_modules", ".next", ".git"].includes(e.name)) walk(rel); } else if (rel.endsWith(".js")) files.push(rel); } })("app"); ["components", "lib"].forEach((d) => (function walk(d2) { for (const e of fs.readdirSync(path.join(ROOT, d2), { withFileTypes: true })) { const rel = d2 + "/" + e.name; if (e.isDirectory()) walk(rel); else if (rel.endsWith(".js")) files.push(rel); } })(d));
  for (let i = files.length - 1; i >= 0; i--) if (files[i].startsWith("app/api/preview-gate/")) files.splice(i, 1); // temporary preview-only gate route
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (f) => strip(fs.readFileSync(path.join(ROOT, f), "utf8"));
  ok("createPinnedClient is used only by lib/context.js (plus the preview-only gate route, removed before merge)", files.filter((f) => /createPinnedClient/.test(src(f))).filter((f) => f !== "lib/supabase/server.js" && f !== "lib/context.js" && !f.startsWith("app/api/preview-gate/")), []);
  ok("the pin header name appears only in lib/supabase/server.js and the preview-only gate route", files.filter((f) => /x-season-tempo-org/.test(src(f))).filter((f) => !f.startsWith("app/api/preview-gate/")), ["lib/supabase/server.js"]);
  ok("the bootstrap is used only by lib/context.js", files.filter((f) => /active-membership/.test(src(f))), ["lib/context.js"]);
  const outside = files.filter((f) => !["lib/supabase/server.js", "lib/context.js", "lib/auth/active-membership.js"].includes(f));
  ok("unmigrated code still builds an unpinned client at 152 sites in 57 files (142 plus Release 2 previewLineupFrom and listTournamentGames, plus RPT-002 qabPlayerReport and qabPlayerChoices, plus player dues schedules: five actions in lib/actions/dues-schedule.js and listDuesSchedules, same pattern as every report query) (3B no-pin compatibility; moved in 3C-2)", [outside.reduce((n, f) => n + (src(f).match(/\bcreateClient\(\)/g) ?? []).length, 0), outside.filter((f) => /\bcreateClient\(\)/.test(src(f))).length], [152, 57]);
  ok("lib/context.js no longer builds an unpinned client itself", /\bcreateClient\(/.test(src("lib/context.js")), false);
  ok("the Settings People list is still on profiles (kept through 3C by decision)", /\.from\("profiles"\)\s*\.select\("id, full_name, role"\)/.test(src("app/(app)/settings/page.js")), true);
  ok("/review is still present (removal scheduled for 3C-4)", fs.existsSync(path.join(ROOT, "app/review/page.js")), true);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
