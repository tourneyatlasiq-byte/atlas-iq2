/**
 * Sign out is always reachable (2026-11).
 *
 * Phones (≤720px) hide the sidebar footer, which held the only Sign out, so
 * a phone user had no way to end the session. Sign out now also lives in the
 * phone's More sheet and on Settings — both the same plain form POST to the
 * existing /logout route, with no new authentication logic.
 *
 *   A. /logout: POST signs out with Supabase once and answers 303 → /login
 *   B. the shared SignOutButton is exactly that form
 *   C. it is in the More sheet and on Settings; desktop's form is unchanged
 *   D. no phone stylesheet rule hides it (verified in a browser separately)
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
let signOuts = 0;
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => ({ auth: { signOut: async () => { signOuts++; return { error: null }; } } }) };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

(async () => {
  console.log("A. /logout");
  const route = require(path.join(ROOT, "app/logout/route.js"));
  const res = await route.POST(new Request("https://www.seasontempo.com/logout", { method: "POST" }));
  assertEq("POST signs out with Supabase exactly once", signOuts, 1);
  assertEq("...and answers 303 to /login", [res.status, res.headers.get("location")], [303, "https://www.seasontempo.com/login"]);
  assertEq("the route's sign-out logic is untouched (one signOut, one redirect)",
    (read("app/logout/route.js").match(/signOut\(/g) ?? []).length, 1);

  console.log("B. the shared button");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { SignOutButton } = require(path.join(ROOT, "components/SignOutButton.js"));
  assertEq("SignOutButton is a plain POST form to /logout with a submit button",
    renderToStaticMarkup(React.createElement(SignOutButton, { className: "x" })),
    '<form action="/logout" method="post" class="signout-form"><button type="submit" class="x">Sign out</button></form>');

  console.log("C. where it appears");
  const nav = read("components/NavSidebar.js");
  const sheet = nav.slice(nav.indexOf('className="sheet-list"'), nav.indexOf('className="sheet-secondary"'));
  assertEq("the phone's More sheet has Sign out", /<SignOutButton className="sheet-row sheet-row-signout">[\s\S]*Sign out/.test(sheet), true);
  assertEq("Settings has Sign out", /<SignOutButton className="btn btn-secondary" \/>/.test(read("components/SettingsClient.js")), true);
  assertEq("desktop's sidebar Sign out is unchanged",
    /<form action="\/logout" method="post">\s*<button type="submit" className="sidebar-signout">Sign out<\/button>\s*<\/form>/.test(nav), true);

  console.log("D. never hidden on phones");
  const css = read("app/globals.css");
  assertEq("no stylesheet rule hides the sheet or Settings Sign out",
    /(signout-form|sheet-row-signout|settings-account)[^{]*\{[^}]*display:\s*none/.test(css), false);
  assertEq("the phone layout still hides only the desktop footer", /\.sidebar-foot \{ display: none; \}/.test(css), true);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
