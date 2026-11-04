/**
 * Uniform sizes, 2026-11.
 *
 *   A. One size list, in order, shared by the roster form and roster queries.
 *   B. PlayerForm rendered: every size is offered, a saved size is selected,
 *      and a stored size outside the list (e.g. "M" from an import) is kept
 *      as an option, so saving the form can never blank it.
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

console.error = consoleError;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
