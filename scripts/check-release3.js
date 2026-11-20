/**
 * Release 3: source-level guards for the small fixes (2026-11).
 * These read the source; the behaviour is covered by the render/e2e checks
 * and the live pass. Run: node scripts/check-release3.js
 */
const fs = require("fs");
let passed = 0, failed = 0;
function ok(label, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  pass ? passed++ : failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${pass ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const src = (p) => fs.readFileSync(p, "utf8");
console.log("\nRelease 3 guards\n");

console.log("TRK-001: the completed game never says tracking continues");
const trk = src("components/TrackerClient.js");
const note = trk.slice(trk.indexOf('className="trk-continuing"') - 200, trk.indexOf('className="trk-continuing"'));
ok("the 'tracking continues' note is gated on tracking being open", /!completedAt\s*&&\s*live\.length\s*>\s*0/.test(note), true);
ok("the completed panel is still there", /QAB tracking complete/.test(trk), true);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
