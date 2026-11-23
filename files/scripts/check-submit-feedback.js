/**
 * Release 3, R3-C: one save at a time per form, in-form errors, confirmations
 * and pressed feedback. The behaviour (rapid taps, changed values while a save
 * is pending, failure with the draft kept, lost response, retry, pressed state)
 * is exercised on real pages in the Release 3 browser pass; these guards pin
 * the wiring so it cannot drift.
 * Run: node scripts/check-submit-feedback.js
 */
const fs = require("fs");
let n = 0, bad = 0;
const eq = (l, a, b = true) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${l}${ok ? "" : `  got ${JSON.stringify(a)}`}`); };
const src = (p) => fs.readFileSync(p, "utf8");
console.log("\nOne save at a time, in-form errors, pressed feedback (Release 3)\n");

console.log("One save at a time per form (values do not matter)");
const um = src("components/useMutation.js"), uaf = src("lib/useActionFeedback.js");
eq("shared runner: a submit while one is in flight is ignored", /if \(busy\.current\) return;\s*busy\.current = true;/.test(um));
eq("...released on success, failure and throw", (um.match(/busy\.current = false/g) || []).length >= 2);
eq("action-feedback runner: same lock", /if \(busy\.current\) return;\s*busy\.current = true;/.test(uaf) && (uaf.match(/busy\.current = false/g) || []).length >= 2);
eq("action-feedback runner reports a thrown (lost) response instead of hanging", /Couldn't reach Season Tempo/.test(uaf));
eq("the lock is per runner, so independent forms stay usable", !/globalThis|window\.__/.test(um + uaf));
const pay = src("components/RecordPaymentSheet.js");
eq("payment sheet: synchronous in-flight lock, released on failure", /if \(!valid \|\| inFlight\.current\) return;/.test(pay) && /inFlight\.current = false;\s*\n\s*setSaving\(false\)/.test(pay));
eq("payment sheet: existing request_key idempotency untouched", /request_key: key\.current/.test(pay));
eq("game form: same lock", /if \(saving\.current\) return;/.test(src("components/GamesSection.js")));
const lu = src("components/LineupClient.js");
eq("lineup: edits are disabled while a save is pending (add, move, remove)", (lu.match(/disabled=\{[^}]*pending[^}]*\}/g) || []).length >= 4);

console.log("\nErrors stay inside the open form");
for (const [f, name] of [["TournamentClient", "tournament edit"], ["RosterClient", "player"], ["GamesSection", "game"], ["EventRoster", "event roster / pickup"]]) {
  eq(`${name}: error rendered inside the form`, /<SheetError>\{error && `\$\{error\} Everything you entered is still here\.`\}<\/SheetError>/.test(src(`components/${f}.js`)) || (f === "EventRoster" && /RefusalNotice error=\{error\}[^\n]*\/>\n\n\s*<button/.test(src("components/EventRoster.js"))));
}
const er = src("components/EventRoster.js");
eq("pickup sheet shows its error (two forms)", (er.match(/<SheetError>/g) || []).length === 2);
eq("the page-level alert is not shown under an open sheet", /\{error && !editing && <RefusalNotice/.test(er));
eq("lineup error is an alert and the save bar says nothing was lost", /notice notice-error" role="alert"/.test(lu) && /Not saved\. Your order is still here/.test(lu));

console.log("\nSaving and success feedback");
for (const f of ["TournamentClient", "RosterClient", "GamesSection", "EventRoster"]) eq(`${f}: success toast names what changed`, /toast\(/.test(src(`components/${f}.js`)));
eq("event roster, pickup and tournament Save buttons are marked busy", (er.match(/aria-busy=\{pending \|\| undefined\}/g) || []).length === 3 && /aria-busy=\{pending \|\| undefined\}/.test(src("components/TournamentClient.js")));
eq("lineup and payment show a Saving state", /"Saving…"/.test(lu) && /Saving<\/>|Saving"/.test(pay) || /st-spin/.test(pay));

eq("an error notice is red, not the green confirmation style (plain and Volt)", /\.notice\.notice-error \{[^}]*194, 27, 58/.test(src("app/globals.css")) && /html:root \.notice\.notice-error \{ background: var\(--owed-t\)/.test(src("app/volt.css")));
console.log("\nPressed feedback covers the controls that are not .btn");
const volt = src("app/volt.css");
for (const sel of [".bench-add", ".lineup-bar-action", ".lineup-panel ol button", ".er-remove", ".er-add-pickup", ".er-pick", ".er-match"]) {
  eq(`${sel} has a pressed rule`, new RegExp(`html:root ${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:active`).test(volt));
}
eq("disabled controls do not press", /\.er-remove:active:not\(:disabled\)/.test(volt));
eq("reduced motion drops the movement", /prefers-reduced-motion: reduce\)[\s\S]*\.er-add-pickup:active:not\(:disabled\) \{ transform: none; \}/.test(volt));

console.log(`\n${n} assertions, ${bad} failed`);
process.exit(bad ? 1 : 0);
