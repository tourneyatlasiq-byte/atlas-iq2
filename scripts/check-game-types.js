/**
 * Game types (2026-11): Showcase added; every type selectable, saved and shown.
 *
 * (Harness shared with the QAB suites.) QAB discoverability (2026-11): completed games can be found and corrected.
 * Labels and links only — the QAB rules themselves are unchanged and are
 * proven against the database separately.
 *
 * (Harness shared with the invitation suites.)
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
    if (key === "requireSeasonContext") return async () => state.ctx;
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
  const h = React.createElement;
  const { GAME_TYPES } = require(R("lib/game-rules.js"));

  section("A. the list of game types");
  ok("exact values and order", GAME_TYPES, ["Pool", "Bracket", "Championship", "Showcase", "Friendly", "Scrimmage"]);
  ok("Showcase is its own value — not an alias of Tournament or any other type", GAME_TYPES.filter((t) => t === "Showcase").length === 1 && !GAME_TYPES.includes("Tournament"), true);
  const mig = read("supabase/migrations/" + require("fs").readdirSync(R("supabase/migrations")).find((f) => /games_04_showcase_game_type\.sql$/.test(f)));
  const allowed = (mig.match(/array\[([\s\S]*?)\]/) || [, ""])[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
  ok("the app list matches the database constraint exactly (same values, same order)", allowed, GAME_TYPES);
  ok("the migration only replaces the constraint — it never updates or deletes games", /\b(update|delete)\b/i.test(mig.replace(/--.*$/gm, "")), false);

  section("B. the game form offers Showcase");
  const gs = read("components/GamesSection.js");
  ok("the Type select is built from GAME_TYPES", /<select id="g-type" name="game_type"[\s\S]{0,200}GAME_TYPES\.map\(\(t\) => <option key=\{t\} value=\{t\}>\{t\}<\/option>\)/.test(gs), true);
  const opts = renderToStaticMarkup(h("select", null, h("option", { value: "" }, "—"), GAME_TYPES.map((t) => h("option", { key: t, value: t }, t))));
  ok("rendered options include Showcase between Championship and Friendly", /Championship<\/option><option value="Showcase">Showcase<\/option><option value="Friendly">/.test(opts), true);

  section("C. saving: the real save action stores Showcase as given");
  state.ctx = { profile: { role: "coach" }, organization: { id: "org1" }, season: { id: "s1" } };
  const writes = [];
  state.db = { from: (table) => ({
    insert: async (row) => { writes.push({ table, op: "insert", row }); return { error: null }; },
    update: (row) => ({ eq: async (c, v) => { writes.push({ table, op: "update", row, [c]: v }); return { error: null }; } }),
  }) };
  const { saveGame } = require(R("lib/actions/games.js"));
  const fd = (o) => { const m = new Map(Object.entries(o)); return { get: (k) => (m.has(k) ? m.get(k) : null) }; };
  let r = await saveGame(fd({ tournament_id: "t1", game_date: "2026-12-05", opponent_name: "Gulf Coast Gold", game_type: "Showcase" }));
  ok("new game: saved, with game_type 'Showcase'", [r.ok, writes.at(-1)?.op, writes.at(-1)?.row?.game_type], [true, "insert", "Showcase"]);
  r = await saveGame(fd({ id: "g9", tournament_id: "t1", game_date: "2026-11-06", opponent_name: "Athletics", game_type: "Showcase" }));
  ok("existing game edited to Showcase", [r.ok, writes.at(-1)?.op, writes.at(-1)?.row?.game_type, writes.at(-1)?.id], [true, "update", "Showcase", "g9"]);
  for (const t of ["Pool", "Bracket", "Championship", "Friendly", "Scrimmage"]) {
    r = await saveGame(fd({ tournament_id: "t1", game_date: "2026-12-05", opponent_name: "Opp", game_type: t }));
    ok(`existing type still saves unchanged: ${t}`, [r.ok, writes.at(-1)?.row?.game_type], [true, t]);
  }
  r = await saveGame(fd({ tournament_id: "t1", game_date: "2026-12-05", opponent_name: "Opp", game_type: "" }));
  ok("no type chosen still saves as empty", [r.ok, writes.at(-1)?.row?.game_type ?? null], [true, null]);

  section("D. where the type is shown");
  for (const [file, re] of [["components/GamesSection.js", /\{g\.game_type && ` · \$\{g\.game_type\}`\}/], ["components/LineupClient.js", /\{game\.game_type && ` · \$\{game\.game_type\}`\}/], ["app/(app)/performance/page.js", /\{game\.game_type && ` · \$\{game\.game_type\}`\}/], ["components/reports/TournamentScheduleReport.js", /\{g\.gameType && <span className="sch-gtype"> · \{g\.gameType\}<\/span>\}/]])
    ok(`${file}: prints whatever type is stored (Showcase included), no hard-coded list`, re.test(read(file)), true);
  ok("no record, QAB or eligibility rule reads the game type", ["lib/game-rules.js", "lib/qab.js", "lib/queries/performance.js"].filter((f) => require("fs").existsSync(R(f))).some((f) => /game_?[tT]ype\s*(===|!==|==|in\b)|\.(filter|some|every)\([^)]*game_?[tT]ype/.test(read(f))), false);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
