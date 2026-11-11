/**
 * Performance tournament selector (2026-11): which tournament Performance shows,
 * the compact selector, and the URL round trip. (Harness shared with the QAB suites.)
 *
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
(async () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const h = React.createElement;
  const L = require(R("lib/performance-tournament.js"));

  // Fixtures modelled on 28/29 Lynch on 2026-11-11.
  const T = (id, name, start, end, decision = "Committed") => ({ id, name, start_date: start, end_date: end, decision });
  const t25 = T("t25", "T25 (Scenic)", "2026-11-06", "2026-11-08");
  const clear = T("clear", "Clearwater Invitational", "2026-11-13", "2026-11-15");
  const smtm = T("smtm", "Show Me The Money", "2026-11-21", "2026-11-22");
  const done = T("done", "Fall Kickoff", "2026-10-02", "2026-10-04");
  const stats = (o) => new Map(Object.entries(o));

  section("A. the default tournament");
  ok("Scenario 1 / the reported case: an upcoming tournament with no games does NOT hide last weekend's tournament with 7 games needing QABs",
    L.pickDefaultTournament([t25, clear, smtm], stats({ t25: { games: 7, needQab: 7 } }), "2026-11-11")?.id, "t25");
  ok("…and it is still chosen when the upcoming tournament is only days away",
    L.pickDefaultTournament([t25, clear], stats({ t25: { games: 7, needQab: 3 } }), "2026-11-12")?.id, "t25");
  ok("Scenario 2: a Fri–Sun tournament is the default on Friday, Saturday and Sunday (inclusive), even if an earlier one needs QABs",
    ["2026-11-13", "2026-11-14", "2026-11-15"].map((d) => L.pickDefaultTournament([t25, clear, smtm], stats({ t25: { games: 7, needQab: 7 }, clear: { games: 5, needQab: 5 } }), d)?.id), ["clear", "clear", "clear"]);
  ok("…and the day after it ends it is no longer 'now'", L.isHappeningNow(clear, "2026-11-16"), false);
  ok("…a one-day tournament with no end date is 'now' on its day", L.isHappeningNow(T("x", "One day", "2026-11-11", null), "2026-11-11"), true);
  ok("Rule 3: with nothing past needing QABs, the next upcoming tournament WITH games beats an earlier one without",
    L.pickDefaultTournament([done, clear, smtm], stats({ done: { games: 4, needQab: 0 }, smtm: { games: 3, needQab: 3 } }), "2026-11-11")?.id, "smtm");
  ok("Scenario 3 / rule 4: an upcoming tournament with no games is the default only when nothing else qualifies",
    L.pickDefaultTournament([clear, smtm], stats({}), "2026-11-11")?.id, "clear");
  ok("Scenario 4 / rule 5: when every past tournament is complete and nothing is upcoming, the most recent one is shown",
    L.pickDefaultTournament([done, t25], stats({ done: { games: 4, needQab: 0 }, t25: { games: 7, needQab: 0 } }), "2026-11-11")?.id, "t25");
  ok("Scenario 4: a completed tournament is not the default while an upcoming one exists",
    L.pickDefaultTournament([t25, clear], stats({ t25: { games: 7, needQab: 0 } }), "2026-11-11")?.id, "clear");
  ok("Rule 2 picks the MOST RECENT past tournament needing QABs",
    L.pickDefaultTournament([done, t25, clear], stats({ done: { games: 4, needQab: 1 }, t25: { games: 7, needQab: 2 } }), "2026-11-11")?.id, "t25");
  ok("no tournaments → none", L.pickDefaultTournament([], new Map(), "2026-11-11"), null);

  section("B. compact selector labels");
  ok("games needing QABs", L.tournamentOptionLabel(t25, { games: 7, needQab: 7 }), "T25 (Scenic) · 7 games need QABs");
  ok("singular", L.tournamentOptionLabel(t25, { games: 7, needQab: 1 }), "T25 (Scenic) · 1 game needs QABs");
  ok("complete", L.tournamentOptionLabel(t25, { games: 7, needQab: 0 }), "T25 (Scenic) · QABs complete");
  ok("no games", L.tournamentOptionLabel(clear, undefined), "Clearwater Invitational · No games yet");
  ok("header timing words", ["now", "past", "upcoming"].map((k) => [L.tournamentTiming(clear, "2026-11-14"), L.tournamentTiming(t25, "2026-11-11"), L.tournamentTiming(clear, "2026-11-11")]).pop(), ["now", "past", "upcoming"]);

  section("C. the real overview query (mocked database)");
  const tables = {
    tournaments: [t25, clear, smtm, T("cons", "Maybe Cup", "2026-12-01", "2026-12-02", "Considering")].map((t) => ({ ...t, season_id: "s1", provider: null, facility: null })),
    games: [...Array.from({ length: 7 }, (_, i) => ({ id: "g" + i, season_id: "s1", tournament_id: "t25", game_date: "2026-11-0" + (6 + Math.floor(i / 3)), start_time: null, opponent_name: "Opp " + i, game_type: "Pool", qab_completed_at: null }))],
    game_lineup_slots: [], plate_appearances: [], tournament_participants: [{ id: "p1", tournament_id: "t25" }],
  };
  const qb = (table) => {
    let rows = (tables[table] ?? []).slice(); let headCount = false;
    const b = {
      select(_c, opts) { if (opts?.head) headCount = true; return b; },
      eq(col, val) { rows = rows.filter((r) => r[col] === val); return b; },
      in(col, vals) { rows = rows.filter((r) => vals.includes(r[col])); return b; },
      order() { return b; },
      then(res, rej) { return Promise.resolve(headCount ? { count: rows.length, error: null } : { data: rows, error: null }).then(res, rej); },
    };
    return b;
  };
  state.db = { from: qb };
  const Q = require(R("lib/queries/performance.js"));
  let o = await Q.getPerformanceOverview("s1", null, "2026-11-11");
  ok("no tournament in the URL → T25 (Scenic), its 7 games, timing 'past'", [o.tournament?.id, o.games.length, o.timing], ["t25", 7, "past"]);
  ok("every game is discoverable without a lineup or QABs (Set batting order state)", o.games.every((g) => g.batters === 0 && g.plateAppearances === 0 && !g.completed), true);
  ok("selector options: committed tournaments in date order with compact labels; 'Considering' without games is not listed",
    o.options.map((x) => x.label), ["T25 (Scenic) · 7 games need QABs", "Clearwater Invitational · No games yet", "Show Me The Money · No games yet"]);
  o = await Q.getPerformanceOverview("s1", "clear", "2026-11-11");
  ok("?tournament=Clearwater → Clearwater, no games, timing 'upcoming'", [o.tournament?.id, o.games.length, o.timing], ["clear", 0, "upcoming"]);
  o = await Q.getPerformanceOverview("s1", "not-in-this-season", "2026-11-11");
  ok("an id from another season or organization is ignored → default", o.tournament?.id, "t25");

  section("D. selector, page and tracker wiring");
  const { PerformanceTournamentPicker } = require(R("components/PerformanceTournamentPicker.js"));
  const pk = renderToStaticMarkup(h(PerformanceTournamentPicker, { options: [{ id: "t25", label: "T25 (Scenic) · 7 games need QABs" }, { id: "clear", label: "Clearwater Invitational · No games yet" }], selectedId: "t25" }));
  ok("selector renders a labelled native select with the chosen tournament selected",
    [/<label[^>]*for="perf-tournament"[^>]*>Tournament</.test(pk), /<select[^>]*id="perf-tournament"/.test(pk), /<option value="t25" selected="">T25 \(Scenic\) · 7 games need QABs</.test(pk)], [true, true, true]);
  ok("with a single tournament the selector is not shown", renderToStaticMarkup(h(PerformanceTournamentPicker, { options: [{ id: "a", label: "A" }], selectedId: "a" })), "");
  ok("choosing a tournament puts it in the URL", /router\.push\(`\/performance\?tournament=\$\{encodeURIComponent\(e\.target\.value\)\}`\)/.test(read("components/PerformanceTournamentPicker.js")), true);
  const page = read("app/(app)/performance/page.js");
  ok("the page reads ?tournament= and passes it to the query", /searchParams\?\.tournament/.test(page) && /getPerformanceOverview\(currentSeason\.id, requested\)/.test(page), true);
  ok("header eyebrow follows the tournament's timing", /TIMING_LABEL\[timing\]/.test(page) && /now: "Happening now", upcoming: "Next up", past: "Played"/.test(page), true);
  ok("an upcoming tournament with no games links to adding games", /href=\{`\/tournaments\?open=\$\{tournament\.id\}`\}>Add games in Tournaments →/.test(page), true);
  ok("returning from QAB tracking lands on the same tournament", /href=\{`\/performance\?tournament=\$\{encodeURIComponent\(game\.tournament_id\)\}`\}/.test(read("components/TrackerClient.js")), true);
  ok("season reporting below is unchanged (same component, same props)", (page.match(/<PerformanceSeason \{\.\.\.season\} gameLinkLabel=\{gameLinkLabel\} \/>/g) ?? []).length, 2);
  ok("game rows keep their four existing actions", ["Review & Edit →", "Continue tracking →", "Start QAB tracking →", "Set batting order →"].every((x) => page.includes(x)), true);

  section("E. the rendered page: selector, header, games and contextual guidance");
  // The real page, with its two queries and the season component stubbed so the
  // test controls exactly which tournament, games and season totals it receives.
  const pagePath = R("app/(app)/performance/page.js");
  const qPath = require.resolve(R("lib/queries/performance.js"));
  const seasonPath = require.resolve(R("components/PerformanceSeason.js"));
  let overview, seasonPA = 0;
  require.cache[qPath] = { id: qPath, filename: qPath, loaded: true, exports: {
    getPerformanceOverview: async (_s, requested) => (typeof overview === "function" ? overview(requested) : overview),
    getSeasonPerformance: async () => ({ team: { pa: seasonPA }, games: [] }),
  } };
  require.cache[seasonPath] = { id: seasonPath, filename: seasonPath, loaded: true, exports: { PerformanceSeason: () => h("div", { className: "stub-season" }, "SEASON REPORTING") } };
  for (const [file, name] of [["components/HelpMenu.js", "HelpMenu"], ["components/FinalScoreFollowUp.js", "FinalScoreFollowUp"]]) {
    const fp = require.resolve(R(file));
    require.cache[fp] = { id: fp, filename: fp, loaded: true, exports: { [name]: () => null } };   // unrelated to this package
  }
  delete require.cache[require.resolve(pagePath)];
  state.ctx = { features: { qab: true }, season: { id: "s1" }, profile: { role: "coach" }, seasonPhase: "current" };
  const Page = require(pagePath).default;
  const render = async (sp) => renderToStaticMarkup(await Page({ searchParams: sp }));
  const game = (id, extra = {}) => ({ id, game_date: "2026-11-06", opponent_name: "Opp " + id, game_type: "Pool", batters: 0, plateAppearances: 0, completed: false, ...extra });
  const opts = [{ id: "t25", label: "T25 (Scenic) · 7 games need QABs" }, { id: "clear", label: "Clearwater Invitational · No games yet" }];

  overview = { tournament: t25, timing: "past", options: opts, games: Array.from({ length: 7 }, (_, i) => game("g" + i)) };
  seasonPA = 0;
  let html = await render({});
  ok("Scenario 1 (T25, played, no QABs): selector shown with T25 selected; header says 'Played'",
    [/<option value="t25" selected="">T25 \(Scenic\) · 7 games need QABs/.test(html), /class="perf-eyebrow">Played</.test(html)], [true, true]);
  ok("…all 7 games listed, each offering 'Set batting order →'", (html.match(/Set batting order →/g) ?? []).length, 7);
  ok("…QAB guidance is shown, OPEN for a first-time team (no QABs this season), as two short sentences: begin, then live or later",
    [/<details class="perf-guide" open="">/.test(html), /Choose a game and set the batting order to begin\.\s+Track plate appearances live during the\s+game or enter them later\./.test(html), /<ol|perf-guide-steps/.test(html)], [true, true, false]);
  ok("…season reporting is still rendered below", html.includes("SEASON REPORTING"), true);
  seasonPA = 42;
  html = await render({});
  ok("experienced team (QABs already recorded): guidance is one collapsed line", [/<details class="perf-guide">/.test(html), /<details class="perf-guide" open/.test(html)], [true, false]);

  overview = { tournament: clear, timing: "now", options: opts, games: [game("a", { batters: 9, plateAppearances: 14 }), game("b", { batters: 9 })] };
  html = await render({});
  ok("Scenario 2 (happening now): header 'Happening now'; Continue and Start offered; guidance shown (one game not started)",
    [/class="perf-eyebrow">Happening now</.test(html), html.includes("Continue tracking →"), html.includes("Start QAB tracking →"), /class="perf-guide"/.test(html)], [true, true, true, true]);

  overview = { tournament: clear, timing: "upcoming", options: opts, games: [] };
  html = await render({});
  ok("Scenario 3 (upcoming, no games): 'Next up', explains games are added in Tournaments, links to that tournament; no QAB guide",
    [/class="perf-eyebrow">Next up</.test(html), /No games yet\. Games are added in Tournaments/.test(html), /href="\/tournaments\?open=clear">Add games in Tournaments →/.test(html), /perf-guide/.test(html)], [true, true, true, false]);

  overview = { tournament: done, timing: "past", options: opts, games: [game("c", { batters: 9, plateAppearances: 20, completed: true }), game("d", { batters: 9, plateAppearances: 18, completed: true })] };
  html = await render({});
  ok("Scenario 4 (completed): every game offers 'Review & Edit →'; no guidance (nothing left to start)",
    [(html.match(/Review &amp; Edit →/g) ?? []).length, /perf-guide/.test(html)], [2, false]);

  overview = (requested) => ({ tournament: requested === "clear" ? clear : t25, timing: "past", options: opts, games: [] });
  html = await render({ tournament: "clear" });
  ok("?tournament= in the URL reaches the query and selects that tournament", /<option value="clear" selected="">/.test(html), true);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
