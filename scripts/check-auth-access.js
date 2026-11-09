/**
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

(async () => {
  const { safeNext, signInErrorReason, signInErrorMessage, isInvitePath } = require(R("lib/auth-redirect.js"));

  section("A. safeNext");
  ok("an app path passes", safeNext("/finance?tab=dues"), "/finance?tab=dues");
  ok("an invitation path passes", safeNext("/invite/0b6f6c2e-1111-4222-8333-444455556666"), "/invite/0b6f6c2e-1111-4222-8333-444455556666");
  for (const bad of ["//evil.com", "/\\evil.com", "@evil.com", "https://evil.com", "evil.com", "/x y", "/ok\r\nSet-Cookie:a=b", "", null, undefined, 42, "/" + "a".repeat(600)]) {
    ok(`rejects ${JSON.stringify(bad)?.slice(0, 30)}`, safeNext(bad), "/dashboard");
  }
  ok("fallback can be null", safeNext("//evil.com", null), null);
  ok("isInvitePath recognises an invitation", [isInvitePath("/invite/abc"), isInvitePath("/invites"), isInvitePath(null)], [true, false, false]);

  section("B. sign-in error reasons");
  ok("expired link (Supabase otp_expired)", signInErrorReason({ errorCode: "otp_expired", description: "Email link is invalid or has expired" }), "expired");
  ok("opened in another browser (no verifier)", signInErrorReason({ message: "invalid request: both auth code and code verifier should be non-empty" }), "other_browser");
  ok("verifier mismatch", signInErrorReason({ message: "code challenge does not match previously saved code verifier" }), "other_browser");
  ok("already used", signInErrorReason({ message: "invalid flow state, no valid flow state found" }), "used");
  ok("unknown text is generic", signInErrorReason({ message: "something odd" }), "failed");
  ok("unknown reason key gets the generic message", signInErrorMessage("<script>alert(1)</script>"), signInErrorMessage("failed"));
  ok("no reason, no message", signInErrorMessage(null), null);

  section("C. /auth/callback");
  const callback = require(R("app/auth/callback/route.js"));
  async function cb(qs, exchangeError = null) {
    state.exchange = { error: exchangeError };
    const res = await callback.GET(new Request(`https://www.seasontempo.com/auth/callback${qs}`));
    return res.headers.get("location");
  }
  ok("success goes to next", await cb("?code=abc&next=%2Finvite%2Fxyz"), "https://www.seasontempo.com/invite/xyz");
  ok("success with no next goes to the dashboard", await cb("?code=abc"), "https://www.seasontempo.com/dashboard");
  ok("an off-site next becomes the dashboard (@host)", await cb("?code=abc&next=%40evil.com"), "https://www.seasontempo.com/dashboard");
  ok("an off-site next becomes the dashboard (//host)", await cb("?code=abc&next=%2F%2Fevil.com"), "https://www.seasontempo.com/dashboard");
  ok("expired link returns to login with the reason and next",
    await cb("?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&next=%2Finvite%2Fxyz"),
    "https://www.seasontempo.com/login?error=expired&next=%2Finvite%2Fxyz");
  ok("other-browser exchange failure is named",
    await cb("?code=abc", { message: "invalid request: both auth code and code verifier should be non-empty" }),
    "https://www.seasontempo.com/login?error=other_browser");
  ok("missing code", await cb(""), "https://www.seasontempo.com/login?error=missing");
  ok("no raw provider text in the URL", /error_description|Email\+link/.test(await cb("?error_code=otp_expired&error_description=Email+link+is+invalid")), false);

  section("D. /logout");
  const logout = require(R("app/logout/route.js"));
  state.signOuts = 0;
  const plain = await logout.POST(new Request("https://www.seasontempo.com/logout", { method: "POST" }));
  ok("plain sign out: 303 to /login, one signOut", [plain.status, plain.headers.get("location"), state.signOuts], [303, "https://www.seasontempo.com/login", 1]);
  const withNext = await logout.POST(new Request("https://www.seasontempo.com/logout", { method: "POST", body: new URLSearchParams({ next: "/invite/xyz" }) }));
  ok("sign out and continue keeps a safe next", withNext.headers.get("location"), "https://www.seasontempo.com/login?next=%2Finvite%2Fxyz");
  const evil = await logout.POST(new Request("https://www.seasontempo.com/logout", { method: "POST", body: new URLSearchParams({ next: "//evil.com" }) }));
  ok("an unsafe next is dropped", evil.headers.get("location"), "https://www.seasontempo.com/login");

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { SignOutButton } = require(R("components/SignOutButton.js"));
  ok("SignOutButton with next carries it as a hidden field",
    renderToStaticMarkup(React.createElement(SignOutButton, { className: "x", next: "/invite/xyz" })),
    '<form action="/logout" method="post" class="signout-form"><input type="hidden" name="next" value="/invite/xyz"/><button type="submit" class="x">Sign out</button></form>');

  section("E. invitation expiry");
  const { isInviteExpired, inviteExpiryFrom, INVITE_TTL_DAYS } = require(R("lib/invite-rules.js"));
  const now = new Date("2026-11-10T12:00:00Z");
  ok("past expiry is expired", isInviteExpired({ expires_at: "2026-11-09T12:00:00Z" }, now), true);
  ok("future expiry is not", isInviteExpired({ expires_at: "2026-11-21T12:00:00Z" }, now), false);
  ok("an accepted invitation is never 'expired'", isInviteExpired({ expires_at: "2026-01-01T00:00:00Z", accepted_at: "2025-12-01T00:00:00Z" }, now), false);
  ok("renewal is 14 days from now", [INVITE_TTL_DAYS, inviteExpiryFrom(now)], [14, "2026-11-24T12:00:00.000Z"]);

  section("F. createInvite / renewInvite");
  const settings = require(R("lib/actions/settings.js"));
  const owner = { profile: { id: "owner-1", role: "owner" }, organization: { id: "org-1" } };
  function form(obj) { const fd = new FormData(); for (const [k, v] of Object.entries(obj)) fd.set(k, v); return fd; }

  state.ctx = owner;
  state.db = invitesDb([{ id: "inv-live", organization_id: "org-1", email: "pat@example.com", role: "coach", accepted_at: null, expires_at: "2099-01-01T00:00:00Z" }]);
  let res = await settings.createInvite(form({ email: "Pat@Example.com", role: "manager", team_id: "team-1" }));
  ok("a live invitation blocks a duplicate, with a pointer to Copy link", [res.ok, /Copy link/.test(res.error)], [false, true]);
  ok("...and nothing is written", state.db.writes.length, 0);

  state.db = invitesDb([{ id: "inv-old", organization_id: "org-1", email: "pat@example.com", role: "coach", team_id: null, accepted_at: null, expires_at: "2020-01-01T00:00:00Z" }]);
  const before = Date.now();
  res = await settings.createInvite(form({ email: "pat@example.com", role: "manager", team_id: "team-1" }));
  const row = state.db.rows[0];
  ok("an expired invitation is renewed in place (same id, no insert)", [res.ok, res.inviteId, res.renewed, state.db.rows.length, state.db.writes.map((w) => w.op)], [true, "inv-old", true, 1, ["update"]]);
  ok("...with the newly chosen role and team", [row.role, row.team_id, row.created_by], ["manager", "team-1", "owner-1"]);
  const days = (new Date(row.expires_at).getTime() - before) / 86400000;
  ok("...and 14 more days", days > 13.99 && days < 14.01, true);

  state.db = invitesDb([]);
  res = await settings.createInvite(form({ email: "new@example.com", role: "coach", team_id: "team-1" }));
  ok("a new address inserts one invitation", [res.ok, state.db.writes.map((w) => w.op)], [true, ["insert"]]);
  res = await settings.createInvite(form({ email: "x@example.com", role: "owner" }));
  ok("owner can never be invited", [res.ok, state.db.writes.length], [false, 1]);

  state.db = invitesDb([{ id: "inv-old", organization_id: "org-1", email: "a@example.com", role: "coach", accepted_at: null, expires_at: "2020-01-01T00:00:00Z" },
                         { id: "inv-other-org", organization_id: "org-2", email: "b@example.com", role: "coach", accepted_at: null, expires_at: "2020-01-01T00:00:00Z" },
                         { id: "inv-used", organization_id: "org-1", email: "c@example.com", role: "coach", accepted_at: "2026-01-01T00:00:00Z", expires_at: "2020-01-01T00:00:00Z" }]);
  res = await settings.renewInvite(form({ id: "inv-old" }));
  ok("renewInvite extends an expired invitation", [res.ok, res.inviteId], [true, "inv-old"]);
  res = await settings.renewInvite(form({ id: "inv-other-org" }));
  ok("renewInvite cannot touch another organization's invitation", [res.ok, state.db.rows[1].expires_at], [false, "2020-01-01T00:00:00Z"]);
  res = await settings.renewInvite(form({ id: "inv-used" }));
  ok("renewInvite cannot revive an accepted invitation", res.ok, false);
  state.ctx = { profile: { id: "coach-1", role: "coach" }, organization: { id: "org-1" } };
  res = await settings.renewInvite(form({ id: "inv-old" }));
  ok("a coach cannot renew", res.ok, false);

  section("G. /login");
  const Login = require(R("app/login/page.js")).default;
  function login(qs) { state.searchParams = new URLSearchParams(qs); return renderToStaticMarkup(React.createElement(Login)); }
  ok("an expired-link return explains itself", login("error=expired").includes("That sign-in link has expired"), true);
  ok("raw text in ?error is never shown", login("error=%3Cb%3Eraw%3C%2Fb%3E").includes("raw"), false);
  ok("no error, no alert", login("").includes("alert-error"), false);
  ok("an invitation next keeps the invitation framing", login("next=%2Finvite%2Fxyz").includes("You&#x27;ve been invited"), true);
  ok("an unsafe next does not switch framing", login("next=%2F%2Finvite%2Fxyz").includes("Welcome back"), true);
  ok("the link only ever carries a validated next", /safeNext\(searchParams\.get\("next"\), null\)/.test(read("app/login/page.js")), true);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
