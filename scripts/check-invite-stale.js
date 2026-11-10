/**
 * Stale-page guard for invitation actions (Phase 2D, 2026-11).
 *
 * Reproduces the production incident of 2026-11-10: a Settings page drawn for
 * the Northgate owner stayed open while the browser signed in as the Test
 * Organization owner. Every invitation action from that page must change
 * nothing and say why. (Harness shared with the Phase 2B suite.)
 *
 * Invitation email delivery (Phase 2B, 2026-11). Resend is never contacted:
 * every request goes to an in-memory stand-in, and the tests assert exactly
 * what would have been sent.
 *
 * (Harness shared with check-auth-access.js.)
 * Login and invitation safety (Phase 1, 2026-11). Behavioural, not textual:
 * the real modules are compiled and run against in-memory stand-ins for
 * Supabase and the request context.
 *
 *   A. safeNext: only same-site paths survive
 *   B. sign-in error reasons map real Supabase messages
 *   C. /auth/callback: never redirects off-site; failures keep `next`
 *   D. /logout: optional, validated `next`
 *   E. invitation expiry rules
 *   F. createInvite / renewInvite: expired renews in place, live blocks
 *   G. /login shows the callback error in our words, never raw text
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
function section(t) { console.log(t); }

/* ---- module stand-ins ---------------------------------------------------- */
const R = (rel) => path.join(ROOT, rel);
const mocks = new Map();
const state = {
  exchange: { error: null }, signOuts: 0, searchParams: new URLSearchParams(),
  ctx: null, db: null, rpc: {}, redirectedTo: null,
};

mocks.set(R("lib/supabase/server.js"), {
  createClient: () => ({
    auth: {
      exchangeCodeForSession: async () => state.exchange,
      signOut: async () => { state.signOuts++; return { error: null }; },
    },
    from: (table) => state.db.from(table),
    rpc: async (name, args) => (state.rpc[name] ? state.rpc[name](args) : { data: null, error: { code: "42883" } }),
  }),
});
mocks.set(R("lib/supabase/client.js"), { createClient: () => ({ auth: {} }) });
mocks.set("next/navigation", {
  useSearchParams: () => state.searchParams,
  useRouter: () => ({ push() {}, refresh() {} }),
  redirect: (to) => { state.redirectedTo = to; throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" }); },
});
mocks.set("next/cache", { revalidatePath() {} });

const realContext = () => require(R("lib/context.js"));
mocks.set(R("lib/context.js"), new Proxy({}, {
  get(_, key) {
    if (key === "getContext") return async () => state.ctx;
    if (key === "isOrgAdmin") return (p) => p?.role === "owner" || p?.role === "admin";
    if (key === "canWrite") return (p) => ["owner", "admin", "coach", "manager"].includes(p?.role);
    if (key === "__esModule") return true;
    return undefined;
  },
}));

const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (mocks.has(request)) return mocks.get(request);
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved && mocks.has(resolved)) return mocks.get(resolved);
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const read = (rel) => fs.readFileSync(R(rel), "utf8");
void realContext;

/* ---- a tiny in-memory invites table ------------------------------------- */
function invitesDb(rows) {
  const writes = [];
  function builder(table) {
    const q = { table, filters: [], op: "select", payload: null, order: null };
    const api = {
      select() { return api; },
      eq(col, v) { q.filters.push((r) => r[col] === v); return api; },
      ilike(col, v) { q.filters.push((r) => String(r[col]).toLowerCase() === String(v).toLowerCase()); return api; },
      is(col, v) { q.filters.push((r) => (r[col] ?? null) === v); return api; },
      order() { return api; },
      insert(p) { q.op = "insert"; q.payload = p; return api; },
      update(p) { q.op = "update"; q.payload = p; return api; },
      delete() { q.op = "delete"; return api; },
      maybeSingle() { return api.run(true); },
      single() { return api.run(true); },
      then(res, rej) { return api.run(false).then(res, rej); },
      async run(one) {
        const match = rows.filter((r) => q.filters.every((f) => f(r)));
        if (q.op === "insert") {
          const row = { id: `new-${rows.length + 1}`, accepted_at: null, expires_at: "2099-01-01T00:00:00.000Z", ...q.payload };
          rows.push(row); writes.push({ op: "insert", row });
          return { data: row, error: null };
        }
        if (q.op === "update") {
          match.forEach((r) => Object.assign(r, q.payload));
          writes.push({ op: "update", ids: match.map((r) => r.id), payload: q.payload });
          return { data: one ? match[0] ?? null : match, error: null };
        }
        return { data: one ? match[0] ?? null : match, error: null };
      },
    };
    return api;
  }
  return { from: builder, rows, writes };
}


// Stylesheets imported by pages are irrelevant here.
Module._extensions[".css"] = () => {};


(async () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const rules = require(R("lib/invite-rules.js"));
  const settings = require(R("lib/actions/settings.js"));
  const PROD = { VERCEL_ENV: "production", INVITE_EMAILS_ENABLED: "true", RESEND_API_KEY: "re_test_key" };
  const NG_ORG = "a71a5000-0000-0000-0000-000000000001", TEST_ORG = "a23c8e8e-cd64-42e4-ab61-ba3cb6e57368";
  const NG_OWNER = { profile: { id: "ng-owner", role: "owner" }, organization: { id: NG_ORG } };
  const TEST_OWNER = { profile: { id: "test-owner", role: "owner" }, organization: { id: TEST_ORG } };
  const SMOKE = "ab976241-231d-4ad5-aeac-fa9bebdfce94";
  const live = "2026-11-24T00:47:15Z", gone = "2026-11-01T00:00:00Z";
  const ngRow = (o) => ({ organization_id: NG_ORG, role: "manager", accepted_at: null, revoked_at: null, expires_at: live, delivery_status: "sent", send_count: 1, ...o });

  let calls;
  function setup({ session, rows, env = PROD }) {
    for (const k of ["VERCEL_ENV", "INVITE_EMAILS_ENABLED", "RESEND_API_KEY"]) delete process.env[k];
    Object.assign(process.env, env);
    state.ctx = session;
    state.db = invitesDb(rows.map((r) => ({ ...r })));
    calls = { tables: [], rpc: [], fetch: 0 };
    const from = state.db.from; state.db.from = (t) => { calls.tables.push(t); return from(t); };
    state.rpc.invite_send_begin = async (a) => { calls.rpc.push("begin"); return { data: { attempt_id: "att", invite_id: a.p_invite_id, email: "x@example.com", role: "coach", organization_name: "N", team_name: "T", inviter_first_name: null, expires_at: live }, error: null }; };
    state.rpc.invite_send_finish = async () => { calls.rpc.push("finish"); return { data: null, error: null }; };
    globalThis.fetch = async () => { calls.fetch++; return { ok: true, status: 200, json: async () => ({ id: "email" }) }; };
  }
  // A form as the stale Northgate page builds it: drawn for the Northgate owner.
  const ngPageForm = (obj) => { const fd = rules.withRenderedContext(new FormData(), "ng-owner", NG_ORG); for (const [k, v] of Object.entries(obj)) fd.set(k, v); return fd; };

  section("A. the rule");
  const fd = rules.withRenderedContext(new FormData(), "a", "o");
  ok("same account and organization match", rules.renderedContextMatches(fd, { accountId: "a", organizationId: "o" }), true);
  ok("different organization", rules.renderedContextMatches(fd, { accountId: "a", organizationId: "o2" }), false);
  ok("different account, same organization", rules.renderedContextMatches(fd, { accountId: "b", organizationId: "o" }), false);
  ok("a form with no context (a page from before 2D) is treated as stale", rules.renderedContextMatches(new FormData(), { accountId: "a", organizationId: "o" }), false);
  ok("the message", rules.STALE_CONTEXT_MESSAGE, "You're now signed in as a different account. Reload this page before making changes.");

  section("B. today's incident: Northgate page, Test Organization session");
  const actions = [
    ["Revoke", () => settings.revokeInvite(ngPageForm({ id: SMOKE }))],
    ["Resend", () => settings.resendInvite(ngPageForm({ id: SMOKE }))],
    ["Retry", () => settings.resendInvite(ngPageForm({ id: SMOKE }))],
    ["Renew", () => settings.renewInvite(ngPageForm({ id: SMOKE }))],
    ["Send invitation", () => settings.createInvite(ngPageForm({ email: "someone@example.com", role: "coach", team_id: "ng-team" }))],
  ];
  for (const [label, act] of actions) {
    setup({ session: TEST_OWNER, rows: [ngRow({ id: SMOKE, email: "autumn7997@msn.com", expires_at: label === "Renew" ? gone : live })] });
    const before = JSON.stringify(state.db.rows);
    const res = await act();
    ok(`${label}: refused with the reload message`, [res.ok, res.stale, res.error], [false, true, rules.STALE_CONTEXT_MESSAGE]);
    ok(`${label}: Northgate data unchanged, nothing read, written, sent or recorded`,
      [JSON.stringify(state.db.rows) === before, state.db.writes.length, calls.tables.length, calls.rpc.length, calls.fetch], [true, 0, 0, 0, 0]);
  }
  setup({ session: TEST_OWNER, rows: [ngRow({ id: SMOKE, email: "autumn7997@msn.com" })], env: {} });
  let res = await settings.revokeInvite(ngPageForm({ id: SMOKE }));
  ok("same with email switched off", [res.ok, res.stale, state.db.writes.length], [false, true, 0]);

  setup({ session: { profile: { id: "ng-owner", role: "owner" }, organization: { id: TEST_ORG } }, rows: [ngRow({ id: SMOKE, email: "autumn7997@msn.com" })] });
  res = await settings.revokeInvite(ngPageForm({ id: SMOKE }));
  ok("same account but a different organization is also stale (ready for multi-org)", [res.ok, res.stale], [false, true]);

  setup({ session: { profile: { id: "ng-coach", role: "coach" }, organization: { id: NG_ORG } }, rows: [ngRow({ id: SMOKE, email: "autumn7997@msn.com" })] });
  res = await settings.revokeInvite(rules.withRenderedContext(Object.assign(new FormData()), "ng-coach", NG_ORG));
  ok("organization authorization still applies first: a coach is refused even with a matching page", [res.ok, /owner or admin/.test(res.error), state.db.writes.length], [false, true, 0]);

  section("C. the same page, still signed in as the Northgate owner");
  setup({ session: NG_OWNER, rows: [ngRow({ id: SMOKE, email: "autumn7997@msn.com" })] });
  res = await settings.revokeInvite(ngPageForm({ id: SMOKE }));
  const row = state.db.rows[0];
  ok("revoke succeeds and is recorded as a state, by whom", [res.ok, !!row.revoked_at, row.revoked_by, state.db.rows.length], [true, true, "ng-owner", 1]);
  ok("...and the send history on the row is kept", [row.delivery_status, row.send_count], ["sent", 1]);

  section("D. zero-change results tell the truth");
  setup({ session: NG_OWNER, rows: [ngRow({ id: "w", email: "w@example.com", revoked_at: "2026-11-10T01:00:00Z" })] });
  res = await settings.revokeInvite(ngPageForm({ id: "w" }));
  ok("revoke an already-withdrawn invitation: reported done (confirmation closes), time kept", [res.ok, res.alreadyWithdrawn, state.db.rows[0].revoked_at], [true, true, "2026-11-10T01:00:00Z"]);
  setup({ session: NG_OWNER, rows: [ngRow({ id: "a", email: "a@example.com", accepted_at: "2026-11-01T00:00:00Z" })] });
  res = await settings.revokeInvite(ngPageForm({ id: "a" }));
  ok("revoke an accepted invitation", [res.ok, res.error], [false, rules.NO_CHANGE.accepted]);
  setup({ session: NG_OWNER, rows: [ngRow({ id: "x", email: "x@example.com", organization_id: TEST_ORG })] });
  res = await settings.revokeInvite(ngPageForm({ id: "x" }));
  ok("revoke an invitation from another organization", [res.ok, res.error, state.db.rows[0].revoked_at], [false, rules.NO_CHANGE.elsewhere, null]);
  setup({ session: NG_OWNER, rows: [ngRow({ id: "w", email: "w@example.com", revoked_at: "2026-11-10T01:00:00Z", expires_at: gone })] });
  res = await settings.renewInvite(ngPageForm({ id: "w" }));
  ok("renew a withdrawn invitation", [res.ok, res.error], [false, rules.NO_CHANGE.withdrawn]);
  setup({ session: NG_OWNER, rows: [ngRow({ id: "a", email: "a@example.com", accepted_at: "2026-11-01T00:00:00Z", expires_at: gone })] });
  res = await settings.renewInvite(ngPageForm({ id: "a" }));
  ok("renew an accepted invitation", [res.ok, res.error], [false, rules.NO_CHANGE.accepted]);
  ok("the old misleading wording is gone", /already been used or withdrawn/.test(read("lib/actions/settings.js")), false);

  section("E. Settings wiring");
  const sc = read("components/SettingsClient.js");
  ok("send/create carries the page context", /run\(createInvite, ctxFd\(fd\)/.test(sc), true);
  ok("row Resend/Retry, Renew, Revoke and the dialog's Retry all build their form with the page context",
    (sc.match(/const fd = ctxFd\(new FormData\(\)\);/g) ?? []).length, 4);
  ok("no invitation action builds a bare form", /const fd = new FormData\(\);\s*fd\.set\("id", (i\.id|inviteId)\);/.test(sc), false);
  ok("context = this page's account and organization", /withRenderedContext\(fd, currentUserId, organization\?\.id\)/.test(sc), true);
  ok("a stale answer shows the reload banner, closes the confirmation and the dialog",
    /result\?\.stale\) \{\s*setStale\(true\);\s*confirm\.cancel\(\);\s*setEditing\(null\);/.test(sc) && /window\.location\.reload\(\)/.test(sc), true);
  ok("while stale, Invite, Resend/Retry, Copy link, Renew and Revoke are all hidden", (sc.match(/isAdmin && !stale/g) ?? []).length, 5);
  const revokeFn = sc.slice(sc.indexOf("function revokeNow("), sc.indexOf("function revokeNow(") + 900);
  ok("a successful revoke removes the row at once and closes the dialog",
    /onSuccess: \(\) => \{\s*setHiddenInvites\(\(prev\) => new Set\(prev\)\.add\(invite\.id\)\);\s*confirm\.cancel\(\);/.test(revokeFn), true);
  ok("revoke asks in the shared dialog, not an inline panel inside the row",
    [/<ConfirmDialog[\s\S]{0,400}title="Revoke invitation\?"/.test(sc), /<ConfirmAction[\s\S]{0,200}Revoke invitation/.test(sc)], [true, false]);
  ok("the dialog names the address and says the link stops working immediately",
    /The invitation to <strong>\{revoking\.email\}<\/strong> stops working immediately/.test(sc), true);
  ok("a revoke error shows inside the dialog; a stale answer closes it and shows the page message",
    /setRevokeError\(message\)/.test(revokeFn) && /result\?\.stale\) \{[\s\S]{0,200}setStale\(true\);\s*confirm\.cancel\(\);/.test(revokeFn), true);
  ok("every row has the same four columns, invited or not",
    (sc.match(/<li key=\{(p|i)\.id\} className="person-row/g) ?? []).length === 2 &&
    (sc.match(/<span className="person-actions"/g) ?? []).length === 2, true);
  ok("the active list excludes accepted, withdrawn and just-revoked rows",
    /invites\.filter\(\(i\) => !i\.accepted_at && !i\.revoked_at && !hiddenInvites\.has\(i\.id\)\)/.test(sc), true);
  ok("the page query still excludes withdrawn invitations", /\.is\("revoked_at", null\)/.test(read("app/(app)/settings/page.js")), true);

  section("F. Settings layout (2D cleanup)");
  const css = read("app/globals.css");
  ok("People & Access has the four column headings, as the quiet eyebrow style",
    /<div className="people-head" aria-hidden="true">\s*<span className="section-eyebrow">Person<\/span>\s*<span className="section-eyebrow">Access<\/span>\s*<span className="section-eyebrow">Role<\/span>\s*<span className="section-eyebrow people-head-actions">Actions<\/span>/.test(sc), true);
  ok("headings and rows share one column template", /\.people-list li\.person-row \{[^}]*grid-template-columns: var\(--people-cols\)/.test(css) && /\.people-head \{[^}]*grid-template-columns: var\(--people-cols\)/.test(css), true);
  ok("headings are hidden where rows stack (phone/tablet)", /@media \(max-width: 980px\) \{[\s\S]*?\.people-head \{ display: none; \}/.test(css), true);
  const actionsBlock = sc.slice(sc.indexOf('<span className="person-actions">'), sc.indexOf("</span>\n                {rowNote?.id"));
  const at = (label) => actionsBlock.indexOf(label);
  ok("action order: primary (Resend/Retry or Renew) first, then Copy link, then Revoke",
    at("Retry") < at("<CopyInviteLink") && at("Renew") < at("<CopyInviteLink") && at("<CopyInviteLink") < at("Revoke\n"), true);
  ok("phone actions: left aligned, one height, compact Revoke", /\.person-row \.person-actions \.btn \{ min-height: 40px; \}/.test(css) && /\.person-row \.person-actions \.btn-danger-ghost \{ padding: 9px 12px; font-size: 13\.5px; \}/.test(css), true);
  // Hierarchy reviewed with Chris (2026-11): Organization | Team | Season,
  // People & Access full width, Your Account | Danger Zone; Danger Zone last on phones.
  const order = ["Organization</span>", "Team</span>", "Season</span>", "People &amp; Access</span>", "Your account</span>", "Danger zone</span>"]
    .map((label) => sc.indexOf(label));
  ok("cards appear in reading order, Danger Zone last", order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), true);
  ok("desktop: six-column grid — thirds for row 1, full width for People & Access, halves for row 3",
    /\.settings-page \.settings-grid \{ grid-template-columns: repeat\(6, minmax\(0, 1fr\)\); \}/.test(css) &&
    /\.settings-page \.settings-grid > \.card \{ grid-column: span 2; \}/.test(css) &&
    /\.settings-page \.settings-grid > \.settings-card-wide \{ grid-column: 1 \/ -1; \}/.test(css) &&
    /\.settings-page \.settings-grid > \.settings-card-half \{ grid-column: span 3; \}/.test(css), true);
  ok("Your Account and Danger Zone are the two halves; People & Access is the only full-width card",
    [/settings-card-half settings-account/.test(sc), /settings-card-half settings-danger-card/.test(sc), (sc.match(/settings-card-wide/g) ?? []).length], [true, true, 1]);
  ok("phones and tablets stack one card per row", /@media \(max-width: 900px\) \{\s*\.settings-page \.settings-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css), true);
  ok("only the grid gap separates cards", /\.settings-page \.settings-grid > \.card \+ \.card \{ margin-top: 0; \}/.test(css), true);
  const tb = read("components/TeamBranding.js");
  ok("Organization keeps logo, name, people count and logo controls in a compact layout",
    [/className="org-identity-top"/.test(tb), /size=\{48\}/.test(tb), /peopleCount/.test(tb), /uploadTeamLogo/.test(tb), /removeTeamLogo/.test(tb)], [true, true, true, true, true]);
  ok("hidden file inputs stay 1px (the logo input made Settings scroll sideways)", /input\[type="file"\]\.visually-hidden \{ width: 1px; padding: 0; border: 0; \}/.test(css), true);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
