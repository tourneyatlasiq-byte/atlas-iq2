/**
 * Team page (2026-11): Needs action names the player, player quick links, and
 * the permission boundary around them.
 * BEHAVIOURAL for the pure rules and the rendered drawer; SOURCE checks for
 * the page's server-side gating.
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const STUB_DIR = path.join(ROOT, "scripts", "__team_stubs__");
const stubs = new Map();
stubs.set("next/cache", { revalidatePath() {} });
stubs.set("next/headers", { cookies() { return { get() {}, set() {}, getAll() { return []; } }; }, headers() { return new Map(); } });
stubs.set("next/navigation", {
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/team",
  redirect() { throw new Error("redirect"); },
  notFound() { throw new Error("notFound"); },
});
stubs.set("next/link", { __esModule: true, default: (props) => require("react").createElement("a", props, props.children) });
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const CONTEXT = path.join(ROOT, "lib", "context.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (stubs.has(request)) return `${STUB_DIR}/${request}`;
  return origResolve.call(this, request, parent, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => null };
  if (resolved === CONTEXT) return { getContext: async () => ({}), canWrite: (p) => ["owner", "admin", "coach", "manager"].includes(p?.role), isOrgAdmin: () => true };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const team = require(path.join(ROOT, "lib", "readiness", "team.js"));
const back = require(path.join(ROOT, "lib", "report-back.js"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const row = (id, name, extra = {}) => ({ id: `r${id}`, player_id: `p${id}`, is_active: true, player: { id: `p${id}`, full_name: name, person_type: "player", ...extra } });

console.log("Needs action wording");
const one = team.teamActions([row(1, "Jordan Park"), row(2, "Avery Lee", { date_of_birth: "2011-01-01", parent_name: "X", parent_phone: "404-555-0101" })]);
const reg1 = one.find((a) => a.id === "registration");
assertEq("one affected player is named", team.teamActionText(reg1), "Jordan Park is missing a date of birth");
const many = team.teamActions([row(1, "A One"), row(2, "B Two"), row(3, "C Three"), row(4, "D Four"), row(5, "E Five")]);
const regMany = many.find((a) => a.id === "registration");
assertEq("several keep the count", team.teamActionText(regMany), "5 players are missing a date of birth");
assertEq("contact wording for one", team.teamActionText({ id: "contact", affected: [row(1, "Sam Ortiz")] }), "Sam Ortiz has no contact details");
assertEq("unknown rule falls back to its own detail", team.teamActionText({ id: "future", detail: "something", affected: [row(1, "X")] }), "something");
assertEq("a nameless player still reads sensibly", team.teamActionText({ id: "registration", affected: [{ id: "r9", player: {} }] }), "Unnamed player is missing a date of birth");
const names = team.affectedNames(regMany, 3);
assertEq("names: first three shown, rest counted", [names.shown.map((r) => r.player.full_name), names.more], [["A One", "B Two", "C Three"], 2]);
assertEq("names: exactly the limit leaves none over", team.affectedNames({ affected: [row(1, "A"), row(2, "B")] }, 3).more, 0);
assertEq("the readiness rules themselves are unchanged (still two checks)", many.map((a) => a.id), ["registration", "contact"]);

console.log("Quick links and permissions");
const links = (o) => team.playerQuickLinks({ playerId: "p1", ...o }).map((l) => l.key);
assertEq("coach, QAB player, dues record: both links", links({ canWrite: true, qabReportPlayerIds: ["p1"], paymentId: "pay1" }), ["qab", "dues"]);
assertEq("QAB link only when the player has at-bats", links({ canWrite: true, qabReportPlayerIds: ["p2"], paymentId: "pay1" }), ["dues"]);
assertEq("dues link only when a dues record exists", links({ canWrite: true, qabReportPlayerIds: ["p1"], paymentId: null }), ["qab"]);
assertEq("a person who cannot write (parent) gets no links at all", links({ canWrite: false, qabReportPlayerIds: ["p1"], paymentId: "pay1" }), []);
assertEq("no player, no links", team.playerQuickLinks({ canWrite: true, qabReportPlayerIds: ["p1"], paymentId: "pay1" }), []);
const l = team.playerQuickLinks({ playerId: "p 1&x", canWrite: true, qabReportPlayerIds: ["p 1&x"], paymentId: "a/b" });
assertEq("ids are encoded in the address", l.map((x) => x.href), ["/reports/qab-player?player=p%201%26x&from=team", "/finance?tab=payments&open=a%2Fb"]);
assertEq("the report's Back accepts team and returns to /team", back.reportBack("team"), { href: "/team", label: "Team" });
assertEq("an unknown origin still falls back to Reports", back.reportBack("evil"), { href: "/reports", label: "Reports" });

console.log("Rendered drawer");
const { PlayerDetail } = require(path.join(ROOT, "components", "RosterClient.js"));
const noop = () => {};
const draw = (props) => renderToStaticMarkup(React.createElement(PlayerDetail, {
  row: row(1, "Jordan Park", { grad_year: 2030 }), canWrite: true, isAdmin: false, documentTargets: { players: [], facilities: [] },
  seasonName: "2026-27", pending: false, onClose: noop, onEdit: noop, onRemove: noop, onToggleActive: noop, onConfirmRemove: noop, onCancelRemove: noop,
  contacts: [], recruiting: { links: [], interests: [] }, ...props,
}));
const withLinks = draw({ quickLinks: team.playerQuickLinks({ playerId: "p1", canWrite: true, qabReportPlayerIds: ["p1"], paymentId: "pay1" }) });
assertEq("drawer shows Quick links with both destinations", [/Quick links/.test(withLinks), /href="\/reports\/qab-player\?player=p1&amp;from=team"/.test(withLinks), /href="\/finance\?tab=payments&amp;open=pay1"/.test(withLinks)], [true, true, true]);
assertEq("drawer shows no empty Quick links row when there is nothing to open", /Quick links/.test(draw({ quickLinks: [] })), false);
assertEq("a parent-style call (canWrite false) renders none", /Quick links/.test(draw({ canWrite: false, quickLinks: team.playerQuickLinks({ playerId: "p1", canWrite: false, qabReportPlayerIds: ["p1"], paymentId: "pay1" }) })), false);

console.log("Page gating (source)");
const page = fs.readFileSync(path.join(ROOT, "app", "(app)", "team", "page.js"), "utf8");
assertEq("QAB choices are read only for QAB organizations and coach-side roles", /const mayWrite = canWrite\(profile\);\s*if \(features\?\.qab && mayWrite\)\s*\{[\s\S]*?qabPlayerChoices\(season\.id\)/.test(page), true);
assertEq("a failed lookup hides the link instead of failing the page", /try \{[\s\S]*?qabPlayerChoices[\s\S]*?\} catch/.test(page), true);
const client = fs.readFileSync(path.join(ROOT, "components", "RosterClient.js"), "utf8");
assertEq("the client uses the shared quick-link rule, not its own", /playerQuickLinks\(\{/.test(client) && !/href=\{`\/finance\?tab=payments/.test(client.replace(/teamActions[\s\S]*?$/, "")), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
