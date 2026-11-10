/**
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
  const { inviteEmailsEnabled } = require(R("lib/email/config.js"));
  const { sendEmail, resendErrorCode } = require(R("lib/email/resend.js"));
  const { buildInvitationEmail, escapeHtml } = require(R("lib/email/invitation.js"));
  const PROD = { VERCEL_ENV: "production", INVITE_EMAILS_ENABLED: "true", RESEND_API_KEY: "re_test_key" };

  section("A. the switch: production + exactly 'true' + a key, or nothing is sent");
  ok("all three present", inviteEmailsEnabled(PROD), true);
  ok("Preview, even with the key and the switch", inviteEmailsEnabled({ ...PROD, VERCEL_ENV: "preview" }), false);
  ok("local / unset environment", inviteEmailsEnabled({ ...PROD, VERCEL_ENV: undefined }), false);
  ok("switch missing (default off)", inviteEmailsEnabled({ ...PROD, INVITE_EMAILS_ENABLED: undefined }), false);
  ok("switch not exactly 'true'", ["TRUE", "1", "yes", " true"].map((v) => inviteEmailsEnabled({ ...PROD, INVITE_EMAILS_ENABLED: v })), [false, false, false, false]);
  ok("key missing or blank", [inviteEmailsEnabled({ ...PROD, RESEND_API_KEY: undefined }), inviteEmailsEnabled({ ...PROD, RESEND_API_KEY: "  " })], [false, false]);
  ok("nothing configured at all", inviteEmailsEnabled({}), false);

  section("B. the Resend request and its answers");
  let calls = [];
  const fakeFetch = (respond) => async (url, init) => { calls.push({ url, init }); return respond(url, init); };
  const okResp = () => ({ ok: true, status: 200, json: async () => ({ id: "email_123" }) });
  calls = [];
  let r = await sendEmail({ to: "pat@example.com", subject: "S", html: "<p>h</p>", text: "t", idempotencyKey: "invite-abc-0" }, { env: PROD, fetchImpl: fakeFetch(okResp) });
  const body = JSON.parse(calls[0].init.body);
  ok("accepted request returns the provider id", r, { ok: true, id: "email_123" });
  ok("POST to Resend's email endpoint", [calls[0].url, calls[0].init.method], ["https://api.resend.com/emails", "POST"]);
  ok("from Season Tempo, Reply-To support", [body.from, body.reply_to], ["Season Tempo <invitations@auth.seasontempo.com>", "support@seasontempo.com"]);
  ok("one recipient, HTML and plain text", [body.to, !!body.html, !!body.text], [["pat@example.com"], true, true]);
  ok("duplicate-protection key sent", calls[0].init.headers["Idempotency-Key"], "invite-abc-0");
  ok("no tracking or tag fields", Object.keys(body).sort(), ["from", "html", "reply_to", "subject", "text", "to"]);
  ok("the key is sent only as the Authorization header", [calls[0].init.headers.Authorization, JSON.stringify(r).includes("re_test_key")], ["Bearer re_test_key", false]);
  calls = [];
  r = await sendEmail({ to: "a@b.co", subject: "S", html: "h", text: "t", idempotencyKey: "k" }, { env: { ...PROD, VERCEL_ENV: "preview" }, fetchImpl: fakeFetch(okResp) });
  ok("Preview: refused before any request", [r, calls.length], [{ ok: false, code: "not_configured" }, 0]);
  ok("status codes become short codes", [401, 403, 422, 400, 429, 500, 503, 418].map(resendErrorCode),
    ["not_configured", "not_configured", "provider_rejected", "provider_rejected", "provider_unavailable", "provider_unavailable", "provider_unavailable", "unknown"]);
  r = await sendEmail({ to: "a@b.co", subject: "S", html: "h", text: "t", idempotencyKey: "k" },
    { env: PROD, fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ message: "Invalid `to` field: a@b.co is not allowed" }) }) });
  ok("provider's own text never comes back", [r, JSON.stringify(r).includes("not allowed")], [{ ok: false, code: "provider_rejected" }, false]);
  r = await sendEmail({ to: "a@b.co", subject: "S", html: "h", text: "t", idempotencyKey: "k" },
    { env: PROD, fetchImpl: async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); } });
  ok("timeout", r, { ok: false, code: "timeout" });
  r = await sendEmail({ to: "a@b.co", subject: "S", html: "h", text: "t", idempotencyKey: "k" },
    { env: PROD, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  ok("network failure", r, { ok: false, code: "provider_unavailable" });
  r = await sendEmail({ to: "a@b.co", subject: "S", html: "h", text: "t", idempotencyKey: "k" },
    { env: PROD, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }) });
  ok("accepted with an unreadable body still counts as handed over", r, { ok: true, id: null });

  section("C. the email");
  const payload = { attempt_id: "att-1", invite_id: "inv-1", email: "Pat.Smith@Example.com", role: "manager",
    organization_name: "Armor <Elite>", team_name: "Mower \"16U\" & Co", inviter_first_name: "Casey", expires_at: "2026-11-24T23:30:00Z" };
  const em = buildInvitationEmail(payload);
  ok("subject: inviter, team, Season Tempo", em.subject, 'Casey invited you to join Mower "16U" & Co on Season Tempo');
  ok("names are escaped in HTML", [em.html.includes("Mower &quot;16U&quot; &amp; Co"), em.html.includes("Armor &lt;Elite&gt;"), em.html.includes("<Elite>")], [true, true, false]);
  ok("Accept invitation points at the invitation page", em.html.includes('href="https://www.seasontempo.com/invite/inv-1"') && em.text.includes("https://www.seasontempo.com/invite/inv-1"), true);
  ok("role in plain language", em.html.includes("as a <strong>Manager</strong>") && em.html.includes("view and update the team&#39;s schedule") === false && em.html.includes("view and update the team's schedule, roster, tournaments and money"), true);
  ok("intended recipient stated (normalised)", em.html.includes("sent to <strong>pat.smith@example.com</strong>") && em.to === "pat.smith@example.com", true);
  ok("expiry date, in US Eastern time", em.html.includes("expires on <strong>November 24, 2026</strong>"), true);
  ok("ignore-if-unexpected and support", [/safely ignore this email/.test(em.html), /support@seasontempo\.com/.test(em.html), /safely ignore this email/.test(em.text)], [true, true, true]);
  const addrs = new Set((em.html + em.text).match(/[\w.+-]+@[\w-]+\.[\w.-]+/g));
  ok("only two addresses appear: the recipient and support (never the owner)", [...addrs].sort(), ["pat.smith@example.com", "support@seasontempo.com"]);
  ok("no images, pixels or tracking parameters", /<img|utm_|track|pixel/i.test(em.html), false);
  const noName = buildInvitationEmail({ ...payload, inviter_first_name: null, team_name: "Mower" });
  ok("no real inviter name: no name invented", [noName.subject, noName.html.includes("You&#39;ve been invited to join <strong>Mower</strong>") || noName.html.includes("You've been invited to join <strong>Mower</strong>")], ["You're invited to join Mower on Season Tempo", true]);
  ok("a line break in a name can't break the subject", buildInvitationEmail({ ...payload, team_name: "A\r\nBcc: x@y.z" }).subject.includes("\n"), false);
  ok("escapeHtml covers quotes and ampersands", escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");

  section("D. sending from Settings");
  const settings = require(R("lib/actions/settings.js"));
  const owner = { profile: { id: "owner-1", role: "owner" }, organization: { id: "org-1" } };
  function form(obj) { const fd = new FormData(); for (const [k, v] of Object.entries(obj)) fd.set(k, v); return fd; }
  const live = "2026-12-01T00:00:00Z", gone = "2026-11-01T00:00:00Z";
  let rpcLog, fetchLog, tables;
  function setup({ env = {}, rows = [], begin, fetchResp = okResp, finishError = null } = {}) {
    for (const k of ["VERCEL_ENV", "INVITE_EMAILS_ENABLED", "RESEND_API_KEY"]) delete process.env[k];
    Object.assign(process.env, env);
    state.ctx = owner;
    state.db = invitesDb(rows);
    tables = [];
    const from = state.db.from; state.db.from = (t) => { tables.push(t); return from(t); };
    rpcLog = []; fetchLog = [];
    state.rpc.invite_send_begin = async (args) => {
      rpcLog.push(["begin", args]);
      if (begin) return begin(args);
      return { data: { ...payload, attempt_id: "att-" + rpcLog.length, invite_id: args.p_invite_id, email: "new@example.com" }, error: null };
    };
    state.rpc.invite_send_finish = async (args) => {
      rpcLog.push(["finish", args]);
      if (args.p_ok) { const row = state.db.rows.find((x) => x.id); if (row) row.send_count = (row.send_count ?? 0) + 1; }
      return { data: null, error: finishError };
    };
    globalThis.fetch = async (url, init) => { fetchLog.push({ url, init }); return typeof fetchResp === "function" ? fetchResp() : fetchResp; };
  }

  setup();
  let res = await settings.createInvite(form({ email: "new@example.com", role: "coach", team_id: "t1" }));
  ok("switch off: invitation created for Copy link, nothing sent", [res.ok, res.emailed, rpcLog.length, fetchLog.length], [true, false, 0, 0]);
  ok("...and it is stored as link-shared (database default 'manual')", "delivery_status" in state.db.rows[0], false);

  setup({ env: { ...PROD, VERCEL_ENV: "preview" } });
  res = await settings.createInvite(form({ email: "new@example.com", role: "coach" }));
  ok("Preview with key and switch: nothing sent", [res.emailed, rpcLog.length, fetchLog.length], [false, 0, 0]);

  setup({ env: PROD });
  res = await settings.createInvite(form({ email: "New@Example.com", role: "coach", team_id: "t1" }));
  ok("on: invitation created as 'queued' and emailed once", [state.db.rows[0].delivery_status, rpcLog.map((x) => x[0]), fetchLog.length], ["queued", ["begin", "finish"], 1]);
  ok("...reported as sent", [res.ok, res.emailed, res.delivery], [true, true, "sent"]);
  ok("...finish records the provider id", rpcLog[1][1], { p_attempt_id: "att-1", p_ok: true, p_message_id: "email_123", p_error_code: null });
  ok("...duplicate-protection key = invitation + successful sends so far", fetchLog[0].init.headers["Idempotency-Key"], `invite-${state.db.rows[0].id}-0`);
  ok("...only the invites table is read: no account lookup by email", [...new Set(tables)], ["invites"]);

  setup({ env: PROD, fetchResp: { ok: false, status: 503, json: async () => ({}) } });
  res = await settings.createInvite(form({ email: "x@example.com", role: "coach" }));
  ok("provider down: invitation kept, failure recorded, owner told", [res.ok, res.delivery, res.code, state.db.rows.length, rpcLog[1][1].p_ok, rpcLog[1][1].p_error_code],
    [true, "failed", "provider_unavailable", 1, false, "provider_unavailable"]);
  const failedId = state.db.rows[0].id;
  globalThis.fetch = async (url, init) => { fetchLog.push({ url, init }); return okResp(); };
  res = await settings.resendInvite(form({ id: failedId }));
  ok("Retry sends again and succeeds", [res.ok, res.delivery], [true, "sent"]);
  ok("...reusing the same key, so a request that did reach Resend isn't sent twice", [fetchLog[0].init.headers["Idempotency-Key"], fetchLog[1].init.headers["Idempotency-Key"]], [`invite-${failedId}-0`, `invite-${failedId}-0`]);
  res = await settings.resendInvite(form({ id: failedId }));
  ok("a deliberate Resend after a success uses a new key", fetchLog[2].init.headers["Idempotency-Key"], `invite-${failedId}-1`);

  for (const msg of ["That invitation was emailed a few minutes ago. You can send it again 10 minutes after the last email.",
                     "That invitation is already being sent.",
                     "Your organization has reached today's limit for invitation emails. Copy the link instead, or try again tomorrow.",
                     "Invitation emails are paused for today. Copy the link instead, or try again tomorrow.",
                     "This invitation was shared by link, so it can't be emailed. To email it, revoke it and send a new invitation."]) {
    setup({ env: PROD, rows: [{ id: "inv-9", organization_id: "org-1", email: "z@example.com", role: "coach", accepted_at: null, revoked_at: null, expires_at: live, delivery_status: "sent", send_count: 1 }],
            begin: async () => ({ data: null, error: { message: msg, code: "23514" } }) });
    res = await settings.resendInvite(form({ id: "inv-9" }));
    ok(`refused, shown as written, nothing sent: "${msg.slice(0, 40)}…"`, [res.ok, res.error, fetchLog.length, rpcLog.filter((x) => x[0] === "finish").length], [false, msg, 0, 0]);
  }
  setup({ env: PROD, begin: async () => ({ data: null, error: { message: 'relation "invite_sends" does not exist', code: "42P01" } }) });
  res = await settings.resendInvite(form({ id: "inv-9" }));
  ok("unexpected database text is never shown", [res.ok, res.error], [false, "We couldn't send that invitation. Copy the link instead."]);

  setup({ env: PROD, fetchResp: () => { throw new TypeError("boom"); } });
  res = await settings.createInvite(form({ email: "y@example.com", role: "coach" }));
  ok("a crash during sending still records the attempt as failed", [res.delivery, rpcLog.at(-1)[0], rpcLog.at(-1)[1].p_ok], ["failed", "finish", false]);

  setup({ env: PROD, finishError: { code: "XX000" } });
  res = await settings.createInvite(form({ email: "w@example.com", role: "coach" }));
  ok("if recording the outcome fails, the owner still gets the true answer", res.delivery, "sent");

  setup({ env: PROD, rows: [{ id: "legacy", organization_id: "org-1", email: "old@example.com", role: "manager", accepted_at: null, revoked_at: null, expires_at: live, delivery_status: "manual" }] });
  res = await settings.createInvite(form({ email: "old@example.com", role: "manager" }));
  ok("live pre-Phase-2 invitation: never emailed, never changed", [res.ok, fetchLog.length, state.db.rows.length, state.db.rows[0].revoked_at, state.db.writes.length], [false, 0, 1, null, 0]);
  setup({ env: PROD, rows: [{ id: "legacy", organization_id: "org-1", email: "old@example.com", role: "manager", accepted_at: null, revoked_at: null, expires_at: gone, delivery_status: "manual" }] });
  res = await settings.createInvite(form({ email: "old@example.com", role: "manager" }));
  const legacy = state.db.rows.find((x) => x.id === "legacy"), fresh = state.db.rows.find((x) => x.id !== "legacy");
  ok("expired pre-Phase-2 invitation + owner invites again: old one withdrawn, a NEW one is emailed",
    [!!legacy.revoked_at, legacy.delivery_status, fresh?.delivery_status, rpcLog[0][1].p_invite_id === fresh?.id, res.delivery], [true, "manual", "queued", true, "sent"]);

  setup({ env: PROD });
  state.ctx = { profile: { id: "coach-1", role: "coach" }, organization: { id: "org-1" } };
  res = await settings.resendInvite(form({ id: "inv-9" }));
  ok("a coach cannot send or resend", [res.ok, rpcLog.length, fetchLog.length], [false, 0, 0]);
  setup({});
  res = await settings.resendInvite(form({ id: "inv-9" }));
  ok("Resend with the switch off: explained, nothing attempted", [res.ok, res.error, rpcLog.length], [false, "Invitation email isn't switched on yet. Use Copy link instead.", 0]);

  section("E. Privacy Policy");
  const legal = require(R("lib/legal.js"));
  const resendEntry = legal.SUBPROCESSORS.find((s) => s.name === "Resend");
  ok("Resend is listed, with sign-in and invitation emails and no tracking", !!resendEntry && /sign-in links and codes, and invitations/.test(resendEntry.detail) && /does not use it to track/.test(resendEntry.detail), true);
  const Privacy = require(R("app/privacy/page.js")).default;
  const ptext = renderToStaticMarkup(React.createElement(Privacy)).replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|\u2019/g, "'").replace(/\s+/g, " ");
  ok("the approved invited-person paragraph, word for word", ptext.includes("When an owner invites you, we store your email address, the role and team they chose, and information about when the invitation was sent so the invitation can work and be resent. The invitation stops working after 14 days unless it is renewed, and the owner can withdraw it at any time."), true);
  ok("sign-in described as link or code", ptext.includes("Sign-in is by emailed link or code"), true);
  ok("policy version unchanged; effective date updated", [legal.PRIVACY_VERSION, legal.PRIVACY_EFFECTIVE_DATE], ["2026-08-01", "November 10, 2026"]);

  section("F. where sending code may live");
  const files = ["app", "lib", "components"].flatMap(function walk(d) {
    return fs.readdirSync(R(d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []);
  });
  const touching = (re) => files.filter((f) => re.test(read(f))).sort();
  ok("only the email boundary talks to Resend", touching(/api\.resend\.com/), ["lib/email/resend.js"]);
  ok("only the switch and the boundary read the key", touching(/RESEND_API_KEY/), ["lib/email/config.js", "lib/email/resend.js"]);
  ok("only the Settings actions start or finish a send", touching(/rpc\(\s*["']invite_send_(begin|finish)/), ["lib/actions/settings.js"]);
  ok("no browser-side file imports the email modules", files.filter((f) => /^["']use client["']/.test(read(f)) && /lib\/email|\.\/email\//.test(read(f))), []);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
