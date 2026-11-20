/**
 * Performance and game tracker on Volt (2026-11-19). Presentation only.
 *
 *   A. which routes get the Volt class (and that the pre-paint script agrees)
 *   B. every Volt rule added for these screens is scoped under html.volt
 *   C. the tracker's commit controls keep their names and conditions
 *   D. the sync status: quiet when saved, prominent when not
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let failed = 0, passed = 0;
function ok(label, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) passed++; else failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${pass ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const section = (t) => console.log(`\n${t}`);

section("A. Volt scope");
const src = read("lib/volt.js").replace(/export /g, "");
const mod = new vm.Script(src + "\n;({ isVoltPath, VOLT_BOOT, VOLT_PATHS })").runInNewContext({});
const { isVoltPath, VOLT_BOOT } = mod;
const cases = [
  ["/performance", true], ["/performance/", true],
  ["/tournaments/t1/games/g1/track", true], ["/tournaments/t1/games/g1/track/", true],
  ["/dashboard", true], ["/tournaments", true], ["/finance", true], ["/team", true],
  ["/tournaments/t1", false], ["/tournaments/t1/games/g1/lineup", true], ["/tournaments/t1/games/g1/lineup/extra", false],
  ["/tournaments/t1/games/g1/track/extra", false], ["/tournaments/t1/games/track", false],
  ["/settings", false], ["/reports", false], ["/performance-x", false], ["/", false],
];
ok("each route is Volt or not as listed", cases.map(([p]) => isVoltPath(p)), cases.map(([, v]) => v));
const boot = (p) => {
  let added = false;
  vm.runInNewContext(VOLT_BOOT, { location: { pathname: p }, document: { documentElement: { classList: { add: () => { added = true; } } } } });
  return added;
};
ok("the pre-paint script gives the same answer for every route", cases.map(([p]) => boot(p)), cases.map(([, v]) => v));
ok("VoltScope uses the same function", /isVoltPath\(pathname\)/.test(read("components/VoltScope.js")), true);

section("B. CSS scope");
const css = read("app/volt.css");
const marker = css.indexOf("Performance and the game tracker (2026-11-19)");
const tail = css.slice(css.indexOf("*/", marker) + 2);
const selectors = [];
tail.replace(/\/\*[\s\S]*?\*\//g, "").replace(/([^{}]+)\{/g, (_, sel) => { if (!sel.trim().startsWith("@")) selectors.push(sel.trim()); return ""; });
const unscoped = selectors.filter((sel) => sel.split(",").some((one) => !/^html\.volt\b/.test(one.trim())));
ok("no unscoped selector in the new section", unscoped, []);
ok("the new section has rules", selectors.length > 40, true);
const g = read("app/globals.css");
ok("the stretched link stays inside .gm-line and never covers the expanded panel", /\.gm-line \{\s*position: relative;/.test(g) && /\.gm-edit::after \{ content: ""; position: absolute; inset: 0;/.test(g), true);

section("C. tracker controls");
const tc = read("components/TrackerClient.js");
ok("Record QAB keeps its label", />\s*Record QAB\s*</.test(tc) && !/Choose a reason<|Select a reason</.test(tc), true);
ok("Record QAB still commits the selection and is still disabled with no reason",
  tc.includes("onClick={() => commit(selected)}") && tc.includes("disabled={!canWrite || selected.length === 0 || noteTooLong}"), true);
ok("No QAB still commits an empty reason set", tc.includes("onClick={() => commit([])}"), true);
ok("the hint reads 'Choose a reason first' while nothing is chosen, and keeps its space after (no layout jump)",
  /canWrite && \(\s*<p className="trk-save-hint" id="trk-save-hint">\s*\{selected\.length === 0 \? "Choose a reason first" : "\\u00a0"\}/.test(tc), true);
ok("Record QAB points at the hint", tc.includes('aria-describedby={canWrite && selected.length === 0 ? "trk-save-hint" : undefined}'), true);

section("D. sync status");
ok("saved stays 'All saved'", tc.includes('const SYNCED = { tone: "ok", text: "All saved" };'), true);
ok("the queue states are unchanged (review, other account, failed, waiting)",
  ["needs your review", "from another account on this device", "Sync failed", "waiting to sync"].every((t) => tc.includes(t)), true);
ok("failed saves are announced as alerts, others as status", tc.includes('role={shownSync.tone === "bad" ? "alert" : "status"}'), true);
ok("offline: an idle offline phone is not shown as 'All saved'", /!online && sync\.tone === "ok"/.test(tc) && tc.includes("Offline. At-bats you record are kept on this phone"), true);
ok("offline never hides a failure or a review prompt (only ok and wait are rewritten)", /!online && sync\.tone === "wait"/.test(tc) && !/!online && sync\.tone === "bad"/.test(tc), true);
ok("the status strip keeps its Retry button for failed saves", /sync\.retry && \(\s*<button type="button" onClick=\{\(\) => sync_\(true\)\}>/.test(tc), true);
ok("quiet saved style: no background; waiting and failed keep a tinted bar",
  /html\.volt \.trk-sync-ok \{[^}]*background: transparent/.test(css) && /html\.volt \.trk-sync-wait \{[^}]*background: var\(--due-t\)/.test(css) && /html\.volt \.trk-sync-bad \{[^}]*background: var\(--owed-t\)/.test(css), true);

console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
