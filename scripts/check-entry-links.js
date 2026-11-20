/** Direct entry links: allowlisted return paths, no open redirect, unknown actions ignored. */
const path = require("path"), fs = require("fs"), Module = require("module");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
let mod;
try { mod = require(path.join(ROOT, "lib", "entry-links.js")); } catch (e) { eq("lib/entry-links.js loads", String(e.message).split("\n")[0], "loads"); process.exit(1); }
const { safeReturnPath, entryHref, parseEntry } = mod;
const P = (s) => new URLSearchParams(s);

console.log("A. return path safety");
eq("Locations path is allowed", safeReturnPath("/facilities"), "/facilities");
eq("its query is kept", safeReturnPath("/facilities?q=park&view=list"), "/facilities?q=park&view=list");
eq("absolute URL refused", safeReturnPath("https://evil.example/facilities"), null);
eq("protocol-relative refused", safeReturnPath("//evil.example"), null);
eq("backslash trick refused", safeReturnPath("/\\evil.example"), null);
eq("other internal pages refused", safeReturnPath("/roster"), null);
eq("lookalike prefix refused", safeReturnPath("/facilities-evil"), null);
eq("javascript scheme refused", safeReturnPath("javascript:alert(1)"), null);
eq("empty and non-strings refused", [safeReturnPath(""), safeReturnPath(null), safeReturnPath(5)], [null, null, null]);

console.log("B. building links");
eq("venue link with return", entryHref("t1", "venue", "/facilities?q=park"), "/tournaments?open=t1&action=venue&return=%2Ffacilities%3Fq%3Dpark");
eq("unsafe return dropped", entryHref("t1", "venue", "//evil.example"), "/tournaments?open=t1&action=venue");
eq("unknown action gives the plain drawer link", entryHref("t1", "bogus", "/facilities"), "/tournaments?open=t1");
eq("no action, no return", entryHref("t1"), "/tournaments?open=t1");

console.log("C. reading links");
eq("venue with return", parseEntry(P("open=t1&action=venue&return=%2Ffacilities%3Fq%3Dpark")), { action: "venue", returnTo: "/facilities?q=park" });
eq("unknown action ignored", parseEntry(P("open=t1&action=drop-table")).action, null);
eq("unsafe return ignored", parseEntry(P("action=venue&return=https%3A%2F%2Fevil.example")).returnTo, null);
eq("empty params", parseEntry(P("")), { action: null, returnTo: null });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
