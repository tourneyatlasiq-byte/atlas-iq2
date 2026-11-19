/**
 * Page scrolling is never left locked (2026-11).
 *
 * Every overlay used to lock the page by saving document.body.style.overflow
 * and restoring that saved value on close. Two overlays open at once (a dialog
 * over a drawer) that close in a different order than they opened restored a
 * stale "hidden" and the page stayed locked until a full reload: a phone could
 * not swipe vertically on any screen, because the lock outlives navigation.
 *
 *   A. lib/scrollLock.js: acquire() returns a release; the page is locked while
 *      any lock is held and restored exactly once when the last is released,
 *      in ANY release order, and a release can be called twice safely
 *   B. no component writes body.style.overflow itself any more
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
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};

console.log("A. shared scroll lock");
global.document = { body: { style: { overflow: "" } } };
const body = global.document.body.style;
let lock;
try { lock = require(path.join(ROOT, "lib", "scrollLock.js")); } catch (e) { assertEq("lib/scrollLock.js exists", String(e.message).split("\n")[0], "loads"); }
if (lock) {
  const { lockScroll } = lock;
  body.overflow = "";
  let r1 = lockScroll();
  assertEq("one lock hides overflow", body.overflow, "hidden");
  r1();
  assertEq("releasing it restores the page", body.overflow, "");

  // the reported bug: drawer opens, dialog opens over it, drawer closes first (Back), dialog closes
  body.overflow = "";
  const drawer = lockScroll(), dialog = lockScroll();
  drawer();
  assertEq("drawer closed under an open dialog: still locked (dialog is open)", body.overflow, "hidden");
  dialog();
  assertEq("dialog closed last: page is released", body.overflow, "");

  // opposite order
  body.overflow = "";
  const a = lockScroll(), b = lockScroll();
  a(); b();
  assertEq("closing in opening order releases the page", body.overflow, "");
  const c = lockScroll(), d = lockScroll();
  d(); c();
  assertEq("closing in reverse order releases the page", body.overflow, "");

  // three at once, scrambled
  const x = lockScroll(), y = lockScroll(), z = lockScroll();
  y(); x();
  assertEq("two of three released: still locked", body.overflow, "hidden");
  z();
  assertEq("last of three released: page released", body.overflow, "");

  // double release must not unlock someone else's lock
  const p = lockScroll(), q = lockScroll();
  p(); p();
  assertEq("releasing twice does not release the other holder", body.overflow, "hidden");
  q();
  assertEq("other holder releases: page released", body.overflow, "");

  // a value set by something else before the first lock comes back
  body.overflow = "scroll";
  const s = lockScroll(); s();
  assertEq("an existing inline value is restored, not wiped", body.overflow, "scroll");
  body.overflow = "";
}

console.log("B. components never write the lock themselves");
const offenders = [];
for (const dir of ["components", "app"]) {
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== "node_modules") walk(full); continue; }
      if (!/\.js$/.test(f.name)) continue;
      if (/body\.style\.overflow\s*=/.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(ROOT, full));
    }
  })(path.join(ROOT, dir));
}
assertEq("no component assigns document.body.style.overflow", offenders, []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
