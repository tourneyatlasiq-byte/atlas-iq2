/**
 * Release 3: Back names for the game pages (TRK-002).
 * The Tracker's back link says where the coach came from and returns there,
 * with the tournament or player scope preserved. Only fixed paths are ever
 * produced; ids are checked as ids; nothing arbitrary is followed.
 * Run: node scripts/check-back-names.js
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const mocks = new Map([["next/link", { __esModule: true, default: (p) => require("react").createElement("a", { href: p.href, className: p.className }, p.children) }]]);
const origLoad = Module._load;
Module._load = function (request, ...rest) { return mocks.has(request) ? mocks.get(request) : origLoad.call(this, request, ...rest); };

let passed = 0, failed = 0;
function ok(label, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  pass ? passed++ : failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${pass ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const R = require(path.join(ROOT, "lib/game-flow-rules.js"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ContextBackLink } = require(path.join(ROOT, "components/ContextBackLink.js"));

console.log("\nBack names for game pages\n");
const T = "6f1c2a10-1111-4222-8333-444455556666", P = "0a0b0c0d-1111-4222-8333-444455556666", S = "9a9b9c9d-1111-4222-8333-444455556666";

console.log("A. Where each name goes");
ok("home is unchanged", R.backTarget("home"), { href: "/dashboard", label: "Home" });
ok("tournament returns to that tournament's drawer", R.backTarget("tournament", { tournamentId: T }), { href: `/tournaments?open=${T}`, label: "Tournament" });
ok("tournament without a valid id has no target", [R.backTarget("tournament", {}), R.backTarget("tournament", { tournamentId: "a/b" })], [null, null]);
ok("performance returns to Performance", R.backTarget("performance", {}), { href: "/performance", label: "Performance" });
ok("performance keeps the selected tournament", R.backTarget("performance", { scope: S }), { href: `/performance?tournament=${S}`, label: "Performance" });
ok("player report returns to the same player (season)", R.backTarget("player-report", { player: P }), { href: `/reports/qab-player?player=${P}`, label: "Player report" });
ok("player report keeps the tournament scope", R.backTarget("player-report", { player: P, scope: S }), { href: `/reports/qab-player?player=${P}&scope=tournament&tournament=${S}`, label: "Player report" });
ok("player report without a player has no target", R.backTarget("player-report", {}), null);

console.log("B. Nothing arbitrary is ever followed");
for (const bad of ["https://evil.example", "//evil.example", "/etc", "HOME", "", undefined, null, ["home"], { x: 1 }]) ok(`from ${JSON.stringify(bad)} is ignored`, R.backTarget(bad, { tournamentId: T, player: P }), null);
for (const id of ["../x", "a b", "x".repeat(65), "<script>", "a?b=1", "a&b"]) ok(`unsafe id ${JSON.stringify(id).slice(0, 20)} is refused`, [R.backTarget("tournament", { tournamentId: id }), R.backTarget("performance", { scope: id }).href, R.backTarget("player-report", { player: P, scope: id }).href], [null, "/performance", `/reports/qab-player?player=${P}`]);
ok("hrefs are always in-app fixed paths", ["home", "performance"].every((n) => /^\/[a-z]/.test(R.backTarget(n, {}).href) && !R.backTarget(n, {}).href.startsWith("//")), true);

console.log("C. Game links carry the origin");
ok("plain route unchanged", R.gameHref("t1", "g1", "lineup"), "/tournaments/t1/games/g1/lineup");
ok("from only (existing behaviour)", R.gameHref("t1", "g1", "track", "home"), "/tournaments/t1/games/g1/track?from=home");
ok("from with scope", R.gameHref("t1", "g1", "track", "performance", { scope: S }), `/tournaments/t1/games/g1/track?from=performance&scope=${S}`);
ok("from with player and scope", R.gameHref("t1", "g1", "track", "player-report", { player: P, scope: S }), `/tournaments/t1/games/g1/track?from=player-report&player=${P}&scope=${S}`);
ok("extras without a from are dropped", R.gameHref("t1", "g1", "track", null, { scope: S }), "/tournaments/t1/games/g1/track");
ok("unknown extra keys are dropped, values encoded", R.gameHref("t1", "g1", "track", "performance", { scope: "a b", evil: "x" }), "/tournaments/t1/games/g1/track?from=performance&scope=a%20b");

console.log("D. The link on the Tracker page");
const render = (props) => renderToStaticMarkup(React.createElement(ContextBackLink, { fallbackHref: "/f", fallbackLabel: "← Lineup", ...props }));
const out = (props) => { const h = render(props); return [((h.match(/href="([^"]*)"/) ?? [])[1] ?? "").replace(/&amp;/g, "&"), h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'")]; };
ok("from Performance: names Performance", out({ from: "performance", tournamentId: T }), ["/performance", "← Performance"]);
ok("from Performance with a tournament selected: keeps it", out({ from: "performance", scope: S, tournamentId: T }), [`/performance?tournament=${S}`, "← Performance"]);
ok("from the tournament drawer: names Tournament", out({ from: "tournament", tournamentId: T }), [`/tournaments?open=${T}`, "← Tournament"]);
ok("from a player report: names Player report, same player and scope", out({ from: "player-report", player: P, scope: S }), [`/reports/qab-player?player=${P}&scope=tournament&tournament=${S}`, "← Player report"]);
ok("from Home: unchanged", out({ from: "home" }), ["/dashboard", "← Home"]);
ok("no origin: the fixed fallback, still honest (it goes to the lineup)", out({}), ["/f", "← Lineup"]);
ok("an origin that cannot be resolved falls back, never a wrong label", [out({ from: "tournament" }), out({ from: "player-report" }), out({ from: "x" })], [["/f", "← Lineup"], ["/f", "← Lineup"], ["/f", "← Lineup"]]);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
