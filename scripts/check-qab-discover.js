/**
 * QAB discoverability (2026-11): completed games can be found and corrected.
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



Module._extensions[".css"] = () => {};
(async () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const h = React.createElement;

  section("A. the season link label");
  const { seasonGameLinkLabel } = require(R("lib/performance-links.js"));
  ok("current season: everyone can review and edit",
    ["owner", "coach", "manager"].map((role) => seasonGameLinkLabel("current", { role })), ["Review & Edit →", "Review & Edit →", "Review & Edit →"]);
  ok("past season: owner/admin can still correct (the database allows it)",
    [seasonGameLinkLabel("past", { role: "owner" }), seasonGameLinkLabel("past", { role: "admin" })], ["Review & Edit →", "Review & Edit →"]);
  ok("past season: coach/manager only view (the database refuses their edits)",
    [seasonGameLinkLabel("past", { role: "coach" }), seasonGameLinkLabel("past", { role: "manager" })], ["View →", "View →"]);

  section("B. Tournaments → Games");
  const { GamesSection } = require(R("components/GamesSection.js"));
  const t = { id: "t-fall", name: "Fall Kickoff Classic" };
  const games = [
    { id: "g-done", opponent_name: "Northside Thunder", game_date: "2026-08-05", qabCompleted: true, plateAppearances: 14, batters: 9, runs_for: 6, runs_against: 1, result: "W" },
    { id: "g-live", opponent_name: "Cobb Crush", game_date: "2026-08-31", qabCompleted: false, plateAppearances: 5, batters: 9 },
    { id: "g-new", opponent_name: "Lake City", game_date: "2026-09-01", qabCompleted: false, plateAppearances: 0, batters: 0 },
  ];
  const gs = renderToStaticMarkup(h(GamesSection, { tournament: t, games, canWrite: true, qabEnabled: true }));
  ok("a completed game says Review & Edit QABs and opens its tracker",
    /href="\/tournaments\/t-fall\/games\/g-done\/track"[^>]*>Review &amp; Edit QABs</.test(gs), true);
  ok("'View QABs' is gone", gs.includes("View QABs"), false);
  ok("an in-progress game still says Continue QABs", /href="\/tournaments\/t-fall\/games\/g-live\/track"[^>]*>Continue QABs</.test(gs), true);
  ok("a game with no lineup still goes to Set lineup", /href="\/tournaments\/t-fall\/games\/g-new\/lineup"[^>]*>Set lineup</.test(gs), true);

  section("C. Performance → Season games (the important one)");
  const { PerformanceSeason } = require(R("components/PerformanceSeason.js"));
  const row = (o) => ({ opponent: "Opp", gameDate: "2026-08-05", startTime: null, gameType: "Pool", tournament: "Fall Kickoff Classic", completed: true,
    result: "W", runsFor: 6, runsAgainst: 1, hasScore: true, pa: 14, qab: 9, qabPct: 64, slots: [], ...o });
  const seasonGames = [
    row({ gameId: "g-old-1", tournamentId: "t-fall", opponent: "Northside Thunder" }),
    row({ gameId: "g-old-2", tournamentId: "t-fall", opponent: "Lake City Lightning", result: "L", runsFor: 6, runsAgainst: 7 }),
    row({ gameId: "g-now", tournamentId: "t-peach", tournament: "Peach State Showdown", opponent: "Peachtree Force", completed: false, hasScore: false, result: null, runsFor: null, runsAgainst: null }),
  ];
  const props = { team: { pa: 54, qab: 30, qabPct: 56, games: 3, players: 12, tournaments: 2 }, reasons: [], reasonsCited: 0, players: [], games: seasonGames, gamesCompleted: 2, record: { w: 1, l: 1, t: 0, winPct: 50, played: 2, total: 3 } };
  const ps = renderToStaticMarkup(h(PerformanceSeason, { ...props, gameLinkLabel: "Review & Edit →" }));
  ok("every tracked game in the season has its own Review & Edit link",
    ["t-fall/games/g-old-1", "t-fall/games/g-old-2", "t-peach/games/g-now"].map((p) => ps.includes(`href="/tournaments/${p}/track"`)), [true, true, true]);
  ok("…including last weekend's games when a newer tournament exists", ps.includes('href="/tournaments/t-fall/games/g-old-1/track"') && ps.includes("Peach State Showdown"), true);
  ok("the link label is the one given", (ps.match(/Review &amp; Edit →/g) ?? []).length, 3);
  ok("the header gets a matching empty column, so figures stay aligned", ps.includes('class="gm-head gm-head-link"'), true);
  ok("the row still expands as before (button kept)", (ps.match(/class="gm-row"/g) ?? []).length, 3);
  const psView = renderToStaticMarkup(h(PerformanceSeason, { ...props, gameLinkLabel: "View →" }));
  ok("past season for a coach: the link says View", [(psView.match(/View →/g) ?? []).length, psView.includes("Review &amp; Edit")], [3, false]);
  const psNone = renderToStaticMarkup(h(PerformanceSeason, props));
  ok("without a label (any other use) nothing changes: no links, original header", [psNone.includes("/track"), psNone.includes("gm-head-link")], [false, false]);

  section("D. the completed tracker view");
  const tc = read("components/TrackerClient.js");
  ok("the explanatory line, word for word",
    tc.replace(/\s+/g, " ").includes("You can edit or remove recorded at-bats anytime. To add a missed at-bat, resume tracking first."), true);
  ok("Corrections is now Edit at-bats (completed-view button and the matching mode tab)",
    [(tc.match(/>\s*Edit at-bats\s*</g) ?? []).length, /\bCorrections\b(?![^<]*\*\/)/.test(tc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))], [2, false]);
  ok("Resume tracking is still its own button", /onClick=\{resume\}[^>]*>\s*Resume tracking/.test(tc), true);
  ok("the add-PA lock message is unchanged", tc.includes("Tracking complete — resume to add a plate appearance."), true);

  section("E. nothing else changed");
  const q = read("lib/queries/performance.js");
  ok("the season query only adds tournamentId (for the link)", /tournamentId: g\.tournament_id \?\? null,/.test(q) && /tournamentId: g\.tournamentId,/.test(q), true);
  const page = read("app/(app)/performance/page.js");
  ok("Performance passes the label to both places the season view appears", (page.match(/gameLinkLabel=\{gameLinkLabel\}/g) ?? []).length, 2);
  ok("the label respects past-season correction rights", /seasonGameLinkLabel\(seasonPhase, profile\)/.test(page), true);

  section("F. responsive layout");
  const css = read("app/globals.css");
  ok("beside the sidebar (721–860px) the season games use the card layout, so the page can't scroll sideways",
    /@media \(min-width: 721px\) and \(max-width: 860px\) \{\s*\.gm-head \{ display: none; \}/.test(css) && /max-width: 860px\)[\s\S]*?\.gm-list > li\.gm-item \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css), true);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
