/**
 * Uniform sizes, 2026-11.
 *
 *   A. One size list, in order, shared by the roster form and roster queries.
 *   B. PlayerForm rendered: every size is offered, a saved size is selected,
 *      and a stored size outside the list (e.g. "M" from an import) is kept
 *      as an option, so saving the form can never blank it.
 *   C. Player drawer on a phone: Edit details is in the header, where
 *      iPhone Safari's bottom toolbar cannot cover it; desktop keeps it in
 *      the footer. Exactly one is shown at any width.
 *
 * Same approach as check-dues-edit.js: JSX compiled with the SWC compiler
 * inside Next.js, framework and database modules stubbed, no network.
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
let passed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}

const stubs = new Map([
  ["next/cache", { revalidatePath() {} }],
  ["next/headers", { cookies() { return { get() {}, set() {} }; }, headers() { return new Map(); } }],
  ["next/navigation", {
    useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/team",
    redirect() {}, notFound() {},
  }],
  ["next/link", { __esModule: true, default: (p) => require("react").createElement("a", p, p.children) }],
]);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (stubs.has(request)) return `/__stub__/${request}`;
  return origResolve.call(this, request, parent, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === path.join(ROOT, "lib", "context.js")) {
    return { requireSeasonContext: async () => ({}), canWrite: () => true, isOrgAdmin: () => true };
  }
  if (resolved && resolved.startsWith(path.join(ROOT, "lib", "supabase") + path.sep)) {
    return { createClient: () => ({}) };
  }
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const SWC_OPTS = {
  jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" },
  module: { type: "commonjs" },
};
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(module, filename);
  const { code } = swc.transformSync(fs.readFileSync(filename, "utf8"), { ...SWC_OPTS, filename });
  module._compile(code, filename);
};

const EXPECTED = ["YXS", "YS", "YM", "YL", "YXL", "AXS", "AS", "AM", "AL", "AXL", "AXXL"];

console.log("A. one size list");
const { UNIFORM_SIZES } = require(path.join(ROOT, "lib", "intake", "registry.js"));
assertEq("UNIFORM_SIZES is youth then adult, smallest to largest", UNIFORM_SIZES, EXPECTED);
const rosterQueries = fs.readFileSync(path.join(ROOT, "lib", "queries", "roster.js"), "utf8");
assertEq("lib/queries/roster.js re-exports the shared list", /export const SIZES = UNIFORM_SIZES;/.test(rosterQueries), true);
const rosterClient = fs.readFileSync(path.join(ROOT, "components", "RosterClient.js"), "utf8");
assertEq("RosterClient has no hand-written size array", /const SIZES = \[/.test(rosterClient), false);

console.log("B. PlayerForm rendered");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const consoleError = console.error;
console.error = (msg, ...rest) => {
  if (typeof msg === "string" && msg.includes("Invalid value for prop") && rest.includes("`action`")) return;
  consoleError(msg, ...rest);
};
const { PlayerForm } = require(path.join(ROOT, "components", "RosterClient.js"));

function selectOf(html, id) {
  const m = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  if (!m) return null;
  const opts = [...m[1].matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map((o) => ({
    value: (o[1].match(/value="([^"]*)"/) || [])[1],
    selected: /selected/.test(o[1]),
  }));
  return { values: opts.map((o) => o.value).filter(Boolean), selected: opts.filter((o) => o.selected).map((o) => o.value) };
}
function render(row) {
  return renderToStaticMarkup(React.createElement(PlayerForm, {
    row, pending: false, onSubmit() {}, onCancel() {},
  }));
}
const base = { id: "r1", player_id: "p1", is_active: true, positions: [], player: { full_name: "Test Player", person_type: "player" } };

const fresh = selectOf(render(null), "jersey_size");
assertEq("new player: jersey select offers every size, in order", fresh && fresh.values, EXPECTED);
assertEq("new player: pants select offers every size", selectOf(render(null), "pants_size")?.values, EXPECTED);

const known = render({ ...base, jersey_size: "AXXL", pants_size: "YXS" });
assertEq("edit: saved AXXL jersey is selected", selectOf(known, "jersey_size")?.selected, ["AXXL"]);
assertEq("edit: saved YXS pants is selected", selectOf(known, "pants_size")?.selected, ["YXS"]);
assertEq("edit: a listed size is not duplicated", selectOf(known, "jersey_size")?.values, EXPECTED);

const legacy = render({ ...base, jersey_size: "M", pants_size: "XS" });
assertEq("edit: stored jersey 'M' (not in list) stays selected", selectOf(legacy, "jersey_size")?.selected, ["M"]);
assertEq("edit: stored pants 'XS' (not in list) stays selected", selectOf(legacy, "pants_size")?.selected, ["XS"]);
assertEq("edit: unlisted value is offered alongside the full list", selectOf(legacy, "jersey_size")?.values, ["M", ...EXPECTED]);

const none = selectOf(render({ ...base, jersey_size: null, pants_size: null }), "jersey_size");
assertEq("edit: no saved size leaves the select on —", none && none.selected, [""]);

console.log("C. player drawer footer and lifecycle actions (redesigned 2026-11)");
const { PlayerDetail } = require(path.join(ROOT, "components", "RosterClient.js"));
function drawer(canWrite, extra = {}) {
  return renderToStaticMarkup(React.createElement(PlayerDetail, {
    row: { ...base, player: { ...base.player } }, canWrite, isAdmin: false, documentTargets: {},
    seasonName: "2026-27", pending: false, onClose() {}, onEdit() {}, onRemove() {},
    onToggleActive() {}, onRoster: true, playerId: "p1", contacts: [], recruiting: { links: [], interests: [] }, ...extra,
  }));
}
const writable = drawer(true);
const head = writable.slice(writable.indexOf('class="drawer-head"'), writable.indexOf('class="drawer-body"'));
const foot = writable.slice(writable.indexOf('class="drawer-foot"'));
assertEq("writer: the header no longer carries a second Edit details button", /Edit details/.test(head), false);
assertEq("writer: the footer carries exactly one Edit details, and it is the volt button",
  (foot.match(/Edit details/g) || []).length === 1 && /btn btn-primary"[^>]*>Edit details</.test(foot), true);
assertEq("writer: Make inactive and Remove from roster are not footer buttons",
  /Make inactive|Remove from roster/.test(foot), false);
assertEq("writer: the header offers a More actions menu", /aria-label="More actions"/.test(head), true);
assertEq("read-only: no Edit details and no More actions anywhere",
  /Edit details|More actions/.test(drawer(false)), false);
const rc = fs.readFileSync(path.join(ROOT, "components", "RosterClient.js"), "utf8");
assertEq("Make active passes the new state (it used to pass the click event, so it could never reactivate)",
  /onSelect: \(\) => onToggleActive\(row\.is_active === false\)/.test(rc) && /toggleActive\(detail, next === true\)/.test(rc), true);
assertEq("the menu explains how the two actions treat history",
  /All history, payments and documents stay/.test(rc) && /Anything paid or played is kept/.test(rc), true);
assertEq("a pickup who is not on the roster gets no lifecycle menu",
  /More actions/.test(drawer(true, { onRoster: false, pickupHistory: [{ id: "t1", name: "T" }], onAddToRoster() {} })), false);
assertEq("...and Add to roster takes the volt button, Edit details is outlined",
  /btn btn-secondary"[^>]*>Edit details</.test(drawer(true, { onRoster: false, pickupHistory: [{ id: "t1", name: "T" }], onAddToRoster() {} }))
  && /btn btn-primary"[^>]*>Add to roster</.test(drawer(true, { onRoster: false, pickupHistory: [{ id: "t1", name: "T" }], onAddToRoster() {} })), true);
// globals.css is pinned (check-qab-trend), so the retired .drawer-head-edit /
// .drawer-foot-edit rules stay in it, unused. The footer button must never
// carry those classes again, or the phone rule would hide it.
assertEq("the footer Edit details does not use the retired phone-hiding class", /drawer-foot-edit|drawer-head-edit/.test(writable), false);

console.error = consoleError;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
