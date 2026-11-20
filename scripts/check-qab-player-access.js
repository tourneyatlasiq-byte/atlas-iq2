/**
 * Individual player QAB report: AUTHORIZATION, executed (RPT-002, 2026-11).
 *
 * Runs the real route (app/reports/qab-player/page.js) and proves, by
 * behaviour, that a parent login, a missing or unknown role, and an
 * organization without QAB are all refused BEFORE any report data is read:
 * the data function is replaced by a spy that would return a player, and the
 * spy must not be called, and nothing it would return may appear in the
 * response. Code inspection alone does not establish that.
 *
 * What this does not prove: the database's own row-level security (parents are
 * additionally limited to their linked children by the plate_appearances
 * policy). That needs a live parent login and is listed as unverified.
 *
 * Run:  node scripts/check-qab-player-access.js
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
const R = (rel) => path.join(ROOT, rel);

/* ---- stand-ins: request context, the data function (a spy), and Next ---- */
const state = { ctx: null, calls: [] };
const SECRET = "Ava Secretname";
const mocks = new Map();
mocks.set(R("lib/context.js"), {
  __esModule: true,
  getContext: async () => state.ctx,
  // The real rule, restated: the same four roles as the database's auth_can_write().
  canWrite: (p) => ["owner", "admin", "coach", "manager"].includes(p?.role),
});
mocks.set(R("lib/queries/reports/qab-player.js"), {
  __esModule: true,
  qabPlayerReport: async (...args) => {
    state.calls.push(args);
    return {
      ok: true,
      tournaments: [],
      report: { organization: { name: "Org" }, team: { name: "16U" }, season: { name: "2026-27" }, scope: { kind: "season" }, player: { name: SECRET, tag: null }, empty: false, summary: { qabPct: 50, qab: 1, pa: 2, games: 1 }, reasons: [], groups: [], games: [], notes: [], generatedAt: "2026-11-20T12:00:00Z" },
    };
  },
});
mocks.set("next/navigation", { useRouter: () => ({ push() {} }) });
mocks.set("next/link", { __esModule: true, default: (p) => require("react").createElement("a", { href: p.href }, p.children) });

const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (mocks.has(request)) return mocks.get(request);
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved && mocks.has(resolved)) return mocks.get(resolved);
  return origLoad.call(this, request, parent, ...rest);
};
Module._extensions[".css"] = () => {};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const route = require(R("app/reports/qab-player/page.js"));
const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const ctxFor = (role, { qab = true, season = true } = {}) => ({
  profile: { role }, features: qab ? { qab: true } : {}, season: season ? { id: "s1" } : null,
});
async function visit(role, search, opts) {
  state.ctx = ctxFor(role, opts); state.calls = [];
  const el = await route.default({ searchParams: search });
  return { el, calls: state.calls.length, out: text(el) };
}
const OWN_CHILD = { player: "child-1" };
const TOURNAMENT = { player: "child-1", scope: "tournament", tournament: "t1" };

(async () => {
  console.log("\nIndividual player QAB report, authorization\n");

  console.log("A. A parent's direct request is denied before any report data is returned");
  for (const [label, search] of [["own child, season", OWN_CHILD], ["own child, tournament scope", TOURNAMENT], ["another player's id", { player: "someone-else" }]]) {
    const r = await visit("parent", search);
    ok(`parent, ${label}: told this report is for coaches`, r.out.includes("This report is for coaches"), true);
    ok(`parent, ${label}: the data function was never called`, r.calls, 0);
    ok(`parent, ${label}: no player data in the response`, [r.out.includes(SECRET), /QAB \/ PA|Quality at-bat rate/.test(r.out)], [false, false]);
  }
  state.ctx = ctxFor("parent"); state.calls = [];
  const meta = await route.generateMetadata({ searchParams: OWN_CHILD });
  ok("parent: the PDF title names nothing and reads no data", [meta.title, state.calls.length], ["QAB Player Report", 0]);

  console.log("B. Any role that cannot write, or no role, is refused the same way");
  for (const role of [undefined, null, "", "viewer", "guest", "Parent", "COACH"]) {
    const r = await visit(role, OWN_CHILD);
    ok(`role ${JSON.stringify(role)}: refused, no data read`, [r.out.includes("This report is for coaches"), r.calls], [true, 0]);
  }

  console.log("C. An organization without QAB is refused first, for every role");
  for (const role of ["owner", "coach", "parent"]) {
    const r = await visit(role, OWN_CHILD, { qab: false });
    ok(`${role}, QAB not enabled: Premium notice, no data read`, [r.out.includes("Premium feature"), r.calls, r.out.includes(SECRET)], [true, 0, false]);
  }
  state.ctx = ctxFor("owner", { qab: false }); state.calls = [];
  ok("QAB not enabled: the PDF title reads no data", [(await route.generateMetadata({ searchParams: OWN_CHILD })).title, state.calls.length], ["QAB Player Report", 0]);

  console.log("D. The four coach-side roles are allowed, and only then is data read");
  for (const role of ["owner", "admin", "coach", "manager"]) {
    const r = await visit(role, TOURNAMENT);
    ok(`${role}: the report is built once for this season, player and tournament`, [r.calls, JSON.stringify(state.calls[0])], [1, JSON.stringify(["s1", "child-1", { tournamentId: "t1" }])]);
    ok(`${role}: not shown the coaches-only notice`, r.out.includes("This report is for coaches"), false);
  }

  console.log("E. Other gates still hold");
  const noSeason = await visit("coach", OWN_CHILD, { season: false });
  ok("no season: told so, no data read", [noSeason.out.includes("No season selected"), noSeason.calls], [true, 0]);
  const noPlayer = await visit("coach", {});
  ok("no player in the address: asked to choose one, no data read", [noPlayer.out.includes("Choose a player"), noPlayer.calls], [true, 0]);
  const longId = await visit("coach", { player: "x".repeat(200) });
  ok("an oversized id is treated as missing, no data read", [longId.out.includes("Choose a player"), longId.calls], [true, 0]);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
