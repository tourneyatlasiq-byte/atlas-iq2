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

  section("H. /invite explains every state; /welcome shows invitations first");
  const InvitePage = require(R("app/invite/[id]/page.js")).default;
  async function invite(view, { org = { name: "Braves" }, rpcError = null } = {}) {
    state.ctx = { user: { email: "me@example.com" }, organization: org };
    state.rpc.invitation_for_viewer = async () => ({ data: rpcError ? null : view, error: rpcError });
    state.redirectedTo = null;
    try {
      return renderToStaticMarkup(await InvitePage({ params: Promise.resolve({ id: "abc" }) }));
    } catch (e) {
      if (e.digest === "NEXT_REDIRECT") return ""; // a silent redirect: the assertions below fail
      throw e;
    }
  }
  const base = { organization_name: "Armor Elite", team_name: "Armor Elite Mower", role: "manager", inviter_first_name: null };
  let html = await invite({ ...base, status: "other_org", viewer_organization_name: "Braves" });
  ok("an account in another org is told why, not redirected", [state.redirectedTo, html.includes("already belongs to <strong>Braves</strong>")], [null, true]);
  ok("...is asked not to create a second account", html.includes("don&#x27;t create a second account"), true);
  ok("...and is not offered an Accept that would fail", html.includes("Accept invitation"), false);
  html = await invite({ ...base, status: "ready", inviter_first_name: "Casey" });
  ok("ready: who, what team, what role", html.includes("Casey invited you to join <strong>Armor Elite Mower</strong>"), true);
  ok("ready: Accept is offered", html.includes("Accept invitation"), true);
  ok("ready: sign-out is available and returns here", html.includes('name="next" value="/invite/abc"'), true);
  html = await invite({ ...base, status: "ready" });
  ok("no inviter name: no name is invented", html.includes("You&#x27;ve been invited to join"), true);
  html = await invite({ ...base, status: "wrong_account", invited_email_masked: "j•••@example.com" });
  ok("wrong account: masked invited address and the signed-in one", [html.includes("j•••@example.com"), html.includes("me@example.com")], [true, true]);
  ok("wrong account: Sign out and continue, returning to this invitation",
    [html.includes("Sign out and continue"), html.includes('name="next" value="/invite/abc"'), html.includes("Accept invitation")], [true, true, false]);
  html = await invite({ ...base, status: "expired" });
  ok("expired: says so and how to fix it", [html.includes("has expired"), html.includes("renew it")], [true, true]);
  html = await invite(null, { rpcError: { code: "22P02" } });
  ok("a malformed link is 'not found', not an error page", html.includes("couldn&#x27;t find that invitation"), true);
  html = await invite({ status: "used" }, { org: null });
  ok("used, no organization: no dashboard button", [html.includes("already been used"), html.includes("/dashboard")], [true, false]);

  const Welcome = require(R("app/welcome/page.js")).default;
  async function welcome(rows, { rpcError = null, org = null } = {}) {
    state.ctx = { user: { email: "me@example.com" }, organization: org };
    state.rpc.my_pending_invitations = async () => ({ data: rpcError ? null : rows, error: rpcError });
    state.redirectedTo = null;
    try { return renderToStaticMarkup(await Welcome()); } catch (e) { if (e.digest === "NEXT_REDIRECT") return null; throw e; }
  }
  html = await welcome([{ invite_id: "inv-1", organization_name: "Armor Elite", team_name: "Armor Elite Mower", role: "manager", inviter_first_name: null, expires_at: "2026-11-21T00:00:00Z" }]);
  ok("a pending invitation is listed with a link to it", html.includes('href="/invite/inv-1"'), true);
  ok("...above own-team setup", html.indexOf('href="/invite/inv-1"') < html.indexOf("Or set up your own team") && html.indexOf("Or set up your own team") < html.indexOf("<form"), true);
  ok("welcome has sign out", html.includes('action="/logout"'), true);
  html = await welcome([]);
  ok("no invitations: the ordinary setup page", [html.includes("invite-list"), html.includes("Set up your team and start running your season.")], [false, true]);
  html = await welcome(null, { rpcError: { code: "42883" } });
  ok("a lookup failure still lets someone set up", html.includes("<form"), true);
  ok("an account with an organization still goes to the dashboard", [await welcome([], { org: { name: "X" } }), state.redirectedTo], [null, "/dashboard"]);

  const migration = read("supabase/migrations/20261109231218_auth_01_invitation_views.sql");
  ok("auth_01: anon cannot execute either view",
    /revoke all on function public\.invitation_for_viewer\(uuid\) from public, anon;/.test(migration) &&
    /revoke all on function public\.my_pending_invitations\(\) from public, anon;/.test(migration), true);
  ok("auth_01: the inviter-name helper is not callable directly",
    /revoke all on function public\.inviter_display_name\(uuid\) from public, anon, authenticated;/.test(migration), true);
  ok("auth_01: every function pins search_path", (migration.match(/set search_path = public/g) ?? []).length, 3);
  ok("auth_01: read-only (no insert/update/delete)", /\b(insert into|update \w+ set|delete from)\b/i.test(migration.replace(/--.*$/gm, "")), false);

  section("I. Sign-in code (length set by Supabase; production sends 8 digits)");
  const { normalizeOtp, OTP_ERROR } = require(R("lib/auth-redirect.js"));
  ok("an 8-digit code (production's length) is accepted as typed or pasted",
    [normalizeOtp("12345678"), normalizeOtp("1234 5678"), normalizeOtp("1234-5678"), normalizeOtp(" 12345678\n")],
    ["12345678", "12345678", "12345678", "12345678"]);
  ok("6 and 10 digits are accepted too, so a length change can't break sign-in", [normalizeOtp("123456"), normalizeOtp("1234567890")], ["123456", "1234567890"]);
  ok("a typed code is accepted with spaces or dashes", [normalizeOtp("123456"), normalizeOtp(" 123 456 "), normalizeOtp("123-456")], ["123456", "123456", "123456"]);
  ok("letters, short or long codes are rejected", [normalizeOtp("12345"), normalizeOtp("12a456"), normalizeOtp("12345678901"), normalizeOtp(null)], [null, null, null, null]);
  const loginSrc = read("app/login/page.js");
  ok("the code is verified as an email OTP for the same address", /verifyOtp\(\{ email, token, type: "email" \}\)/.test(loginSrc), true);
  ok("the phone can offer the code from the email", /autoComplete="one-time-code"/.test(loginSrc), true);
  ok("provider text is never shown for a bad code", [/setCodeError\(OTP_ERROR\)/.test(loginSrc), /setCodeError\(error/.test(loginSrc)], [true, false]);
  ok("after a code, only the validated next is followed", /window\.location\.assign\(next \?\? "\/dashboard"\)/.test(loginSrc), true);
  ok("the bad-code message is ours", OTP_ERROR.startsWith("That code didn't work."), true);
  const signInText = [loginSrc, read("lib/auth-redirect.js")].join("\n").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  ok("no user-facing text assumes a code length", /\b(6|six|8|eight)-digit\b/i.test(signInText), false);
  ok("the code box shows no example digits", /placeholder="\d+"/.test(loginSrc), false);
  ok("the code box allows a full 10-digit code with spaces", /maxLength=\{12\}/.test(loginSrc), true);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
