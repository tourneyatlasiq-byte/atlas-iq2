/**
 * Invitation lifecycle (Phase 2A, 2026-11): revoke as a state, status-aware
 * rows, no email sending. Shares its harness with check-auth-access.js.
 *
 * (Harness copied from the Phase 1 suite.)
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
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const rules = require(R("lib/invite-rules.js"));
  const now = new Date("2026-11-10T12:00:00Z");
  const live = "2026-11-21T00:00:00Z", gone = "2026-11-01T00:00:00Z";

  section("A. what a pending row says");
  ok("pre-Phase-2 invitation (manual) reads 'Link shared manually'",
    [rules.inviteRowStatus({ delivery_status: "manual", expires_at: live }, now), rules.INVITE_STATUS_TEXT.manual],
    ["manual", "Link shared manually"]);
  ok("a missing or unknown status never claims an email was sent",
    [rules.inviteRowStatus({ expires_at: live }, now), rules.inviteRowStatus({ delivery_status: "weird", expires_at: live }, now)], ["manual", "manual"]);
  ok("sent / failed / queued / sending", [
    rules.inviteRowStatus({ delivery_status: "sent", expires_at: live }, now),
    rules.inviteRowStatus({ delivery_status: "failed", expires_at: live }, now),
    rules.inviteRowStatus({ delivery_status: "queued", expires_at: live }, now),
    rules.inviteRowStatus({ delivery_status: "sending", expires_at: live }, now)], ["sent", "failed", "sending", "sending"]);
  ok("expiry outranks delivery state", rules.inviteRowStatus({ delivery_status: "sent", expires_at: gone }, now), "expired");
  ok("'Sent' is explained as handed to the provider, not delivered",
    /provider/i.test(rules.SENT_MEANS) && /doesn't confirm/i.test(rules.SENT_MEANS), true);

  const settings = require(R("lib/actions/settings.js"));
  const owner = { profile: { id: "owner-1", role: "owner" }, organization: { id: "org-1" } };
  // Forms carry the account/organization the page was drawn for (Phase 2D);
  // these suites act as the signed-in account, so they match by default.
  function form(obj) {
    const fd = new FormData();
    fd.set("rendered_account", state.ctx?.profile?.id ?? "");
    fd.set("rendered_org", state.ctx?.organization?.id ?? "");
    for (const [k, v] of Object.entries(obj)) fd.set(k, v);
    return fd;
  }
  const row = (o) => ({ organization_id: "org-1", role: "coach", accepted_at: null, revoked_at: null, expires_at: live, delivery_status: "manual", ...o });

  section("B. revoke is a state, never a delete");
  state.ctx = owner;
  state.db = invitesDb([row({ id: "inv-1", email: "a@example.com" }), row({ id: "inv-x", organization_id: "org-2", email: "b@example.com" }),
                        row({ id: "inv-acc", email: "c@example.com", accepted_at: "2026-11-01T00:00:00Z" }), row({ id: "inv-rev", email: "d@example.com", revoked_at: "2026-11-02T00:00:00Z" })]);
  let res = await settings.revokeInvite(form({ id: "inv-1" }));
  const r1 = state.db.rows.find((r) => r.id === "inv-1");
  ok("revoking marks the row withdrawn, by whom", [res.ok, !!r1.revoked_at, r1.revoked_by], [true, true, "owner-1"]);
  ok("...and the row still exists", state.db.rows.length, 4);
  ok("no delete was issued", state.db.writes.some((w) => w.op === "delete"), false);
  res = await settings.revokeInvite(form({ id: "inv-x" }));
  ok("another organization's invitation is untouched", [res.ok, state.db.rows.find((r) => r.id === "inv-x").revoked_at], [false, null]);
  res = await settings.revokeInvite(form({ id: "inv-acc" }));
  ok("an accepted invitation cannot be revoked", [res.ok, state.db.rows.find((r) => r.id === "inv-acc").revoked_at], [false, null]);
  const before = state.db.rows.find((r) => r.id === "inv-rev").revoked_at;
  res = await settings.revokeInvite(form({ id: "inv-rev" }));
  // Phase 2D: already withdrawn is reported truthfully as done, and the
  // original revoke time is never overwritten.
  ok("revoking twice: reported as already withdrawn, original time kept", [res.ok, res.alreadyWithdrawn, state.db.rows.find((r) => r.id === "inv-rev").revoked_at], [true, true, before]);
  state.ctx = { profile: { id: "coach-1", role: "coach" }, organization: { id: "org-1" } };
  state.db = invitesDb([row({ id: "inv-1", email: "a@example.com" })]);
  res = await settings.revokeInvite(form({ id: "inv-1" }));
  ok("a coach cannot revoke", [res.ok, state.db.writes.length], [false, 0]);
  ok("cancelInvite (the old hard delete) is gone", typeof settings.cancelInvite, "undefined");

  section("C. inviting again after a revoke; one live invitation per address");
  state.ctx = owner;
  state.db = invitesDb([row({ id: "inv-rev", email: "pat@example.com", revoked_at: "2026-11-02T00:00:00Z" })]);
  res = await settings.createInvite(form({ email: "pat@example.com", role: "manager", team_id: "t1" }));
  ok("a withdrawn invitation doesn't block a new one", [res.ok, state.db.writes.map((w) => w.op)], [true, ["insert"]]);
  ok("...and the withdrawn row is left as it was", state.db.rows[0].revoked_at, "2026-11-02T00:00:00Z");
  ok("new invitations are not marked for email in 2A (database default 'manual')", "delivery_status" in state.db.rows[1], false);
  state.db = invitesDb([]);
  const ins = state.db.from;
  state.db.from = (t) => { const b = ins(t); const orig = b.insert; b.insert = (p) => { orig(p); b.run = async () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"invites_one_live_per_email\"" } }); return b; }; return b; };
  res = await settings.createInvite(form({ email: "race@example.com", role: "coach" }));
  ok("a simultaneous duplicate gets our message, not the database's", [res.ok, /already has an invitation waiting/.test(res.error), /duplicate key/.test(res.error)], [false, true, false]);
  state.db = invitesDb([row({ id: "inv-rev", email: "e@example.com", revoked_at: "2026-11-02T00:00:00Z", expires_at: gone })]);
  res = await settings.renewInvite(form({ id: "inv-rev" }));
  ok("a withdrawn invitation cannot be renewed", [res.ok, state.db.rows[0].expires_at], [false, gone]);

  section("D. the invitation page and acceptance");
  const InvitePage = require(R("app/invite/[id]/page.js")).default;
  state.ctx = { user: { email: "me@example.com" }, organization: null };
  state.rpc.invitation_for_viewer = async () => ({ data: { status: "revoked", organization_name: "Armor Elite" }, error: null });
  const html = renderToStaticMarkup(await InvitePage({ params: Promise.resolve({ id: "abc" }) }));
  ok("withdrawn invitation is explained", [html.includes("This invitation was withdrawn"), html.includes("<strong>Armor Elite</strong> withdrew")], [true, true]);
  ok("...with no Accept button", html.includes("Accept invitation"), false);
  const { acceptInvitation } = require(R("lib/actions/invite.js"));
  state.rpc.accept_invite = async () => ({ data: null, error: { message: "That invitation was withdrawn. Ask for a new one." } });
  ok("acceptance shows the withdrawn message as written", await acceptInvitation("abc"), { ok: false, error: "That invitation was withdrawn. Ask for a new one." });

  section("E. Settings rows and scope");
  const sc = read("components/SettingsClient.js");
  ok("rows use the shared status rule", /inviteRowStatus\(i\)/.test(sc), true);
  ok("'Sent' rows carry the honest explanation", /title=\{status === "sent" \? SENT_MEANS : undefined\}/.test(sc), true);
  ok("Revoke replaces Cancel and calls revokeInvite", [/>\s*Revoke\s*</.test(sc), /runMutation\(revokeInvite, fd,/.test(sc), /cancelInvite/.test(sc)], [true, true, false]);
  ok("Settings hides withdrawn invitations", /\.is\("revoked_at", null\)/.test(read("app/(app)/settings/page.js")), true);
  void ["app", "lib", "components"].flatMap(function walk(d) {
    return fs.readdirSync(R(d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []);
  }).map(read).join("\n");
  // Phase 2B added sending; where it may live is asserted in check-invite-email.js.
  const mig = fs.readFileSync(R("supabase/migrations/20261110000952_inv_01_invitation_delivery.sql"));
  ok("inv_01 file is byte-identical to what production applied", require("crypto").createHash("md5").update(mig).digest("hex"), "b77ae770e4c4da935ca197455883084f");

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
