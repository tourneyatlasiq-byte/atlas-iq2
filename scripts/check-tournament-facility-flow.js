/**
 * Tournament Add form: facility carry-over, new-facility prefill, and the
 * drawer layout/wording cleanup (2026-11-22).
 *
 * Found by a coach: a new Add tournament form opened with the PREVIOUS
 * tournament's facility, and "Add facility" opened a blank form that forgot
 * the search. Cause: a facility id remembered by the page and re-applied to
 * every form that opened later (Edit forms included). The fix hands a created
 * facility to the open form exactly once and forgets it when the form closes.
 * Verified on the real component in 390px phone emulation; these guards keep
 * the pieces from drifting apart.
 * Run: node scripts/check-tournament-facility-flow.js
 */
const fs = require("fs");
let n = 0, bad = 0;
const eq = (l, a, b = true) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${l}${ok ? "" : `\n        expected ${JSON.stringify(b)}\n        actual   ${JSON.stringify(a)}`}`); };
const src = (p) => fs.readFileSync(p, "utf8");
const tc = src("components/TournamentClient.js");
const qa = src("components/QuickAddFacility.js");
const volt = src("app/volt.css");
const status = src("lib/tournament-status.js");

console.log("\nFacility does not carry over to later forms\n");
eq("the old page-level remembered facility id is gone", !/justCreatedFacilityId/.test(tc));
eq("a created facility is handed over as a one-shot value", /setFacilityJustAdded\(\{ facility, seq: Date\.now\(\) \}\)/.test(tc));
eq("it is forgotten when the form closes", /if \(!editing\) setFacilityJustAdded\(null\)/.test(tc));
eq("a form that opens later ignores a value that was already there", /const alreadyThere = useRef\(facilityJustAdded\)/.test(tc) && /facilityJustAdded === alreadyThere\.current/.test(tc));
eq("a form starts with only its own tournament's facility", /useState\(row\?\.facility\?\.id \?\? ""\)/.test(tc));

console.log("\nAdd facility keeps the search and the draft\n");
eq("the typed search text reaches the new-facility form", /onAddFacility\?\.\(typed\)/.test(tc) && /setAddingFacility\(\{ name: name \?\? "" \}\)/.test(tc));
eq("the new-facility name field starts with that text", /defaultValue=\{initialName\}/.test(qa) && /initialName = ""/.test(qa));
eq("focus goes to City when the name is already filled", /autoFocus=\{Boolean\(initialName\)\}/.test(qa) && /autoFocus=\{!initialName\}/.test(qa));
eq("opening Add facility does not close the search", !/setPickingFacility\(false\);\s*onAddFacility/.test(tc));
eq("a saved facility is selected in the open form and the search closes", /setFacilityId\(facilityJustAdded\.facility\.id\)/.test(tc) && /setPickingFacility\(false\)/.test(tc));
eq("Cancel only closes the new-facility form", /onClose=\{\(\) => setAddingFacility\(null\)\}/.test(tc));

console.log("\nBudget wording is consistent\n");
eq("Considering rows say Not in Budget", /sub: `Not in Budget\$\{reg\}`/.test(status) && !/not in budget/.test(status));
eq("the Costs summary says Budget not linked", /"Budget not linked"/.test(tc) && !/"budget not linked"/.test(tc));

console.log("\nDrawer layout guards\n");
eq("status selects share one label row and one select row", /grid-template-rows: subgrid/.test(volt) && /\.t-status select \{ width: 100%; height: 44px/.test(volt));
eq("summary tiles keep label, value and caption on shared rows", /grid-template-rows: 14px 30px auto/.test(volt));
eq("long amounts shrink instead of clipping", /\.t-metric-value\.is-long/.test(volt) && /is-xlong/.test(tc));
eq("game rows: details left, score right, one action row", /html\.volt \.game-row \{\s*display: grid; grid-template-columns: 26px minmax\(0, 1fr\) auto/.test(volt) && /html\.volt \.game-actions \{ grid-column: 1 \/ -1/.test(volt));
eq("footer buttons are the same height", /\.drawer-foot \.btn \{\s*min-height: 48px; height: 48px/.test(volt));

console.log(`\n${n - bad}/${n} passed${bad ? `, ${bad} FAILED` : ""}\n`);
process.exit(bad ? 1 : 0);
