/**
 * Performance and game tracker on Volt (2026-11-19). Presentation only.
 *
 *   B. every Volt rule added for these screens is scoped under html:root
 *   C. the tracker's commit controls keep their names and conditions
 *   D. the sync status: quiet when saved, prominent when not
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let failed = 0, passed = 0;
function ok(label, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) passed++; else failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${pass ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const section = (t) => console.log(`\n${t}`);

section("B. CSS scope");
const css = read("app/volt.css");
const marker = css.indexOf("Performance and the game tracker (2026-11-19)");
const tail = css.slice(css.indexOf("*/", marker) + 2);
const selectors = [];
tail.replace(/\/\*[\s\S]*?\*\//g, "").replace(/([^{}]+)\{/g, (_, sel) => { if (!sel.trim().startsWith("@")) selectors.push(sel.trim()); return ""; });
const unscoped = selectors.filter((sel) => sel.split(",").some((one) => !/^html:root\b/.test(one.trim())));
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
const ss = fs.readFileSync("lib/sync-status.js", "utf8");
ok("saved stays 'All saved' (now defined in the one tested status module, never the starting value)", ss.includes('export const ALL_SAVED = { tone: "ok", text: "All saved" };') && !tc.includes("useState(SYNCED)"), true);
ok("the queue states are unchanged (review, other account, failed, waiting)",
  ["needs", "from another account on this device", "Sync failed", "waiting to sync"].every((t) => ss.includes(t)), true);
ok("failed saves are announced as alerts, others as status", tc.includes('role={shownSync.tone === "bad" ? "alert" : "status"}'), true);
ok("offline: an idle offline phone is not shown as 'All saved'", /online \? ALL_SAVED : \{/.test(ss) && ss.includes("Offline. At-bats you record are kept on this phone"), true);
ok("offline never hides a failure or a review prompt (review and failure are decided before the offline wording)", ss.indexOf("status.review > 0") < ss.indexOf("Offline.") && ss.indexOf("status.failed > 0") < ss.indexOf("(offline)"), true);
ok("the status strip keeps its Retry button for failed saves", /sync\.retry && \(\s*<button type="button" onClick=\{\(\) => \(restore === "failed" \? runRestore\(\) : sync_\(true\)\)\}>/.test(tc), true);
ok("quiet saved style: no background; waiting and failed keep a tinted bar",
  /html:root \.trk-sync-ok \{[^}]*background: transparent/.test(css) && /html:root \.trk-sync-wait \{[^}]*background: var\(--due-t\)/.test(css) && /html:root \.trk-sync-bad \{[^}]*background: var\(--owed-t\)/.test(css), true);

console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
