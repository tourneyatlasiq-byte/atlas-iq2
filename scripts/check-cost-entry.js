/**
 * Costs and payments: a coach can add or edit the registration cost from the
 * section itself (2026-11-22), and the Registration & payment help stays inside
 * the drawer.
 *
 * Found by a coach: after registering a tournament and linking its budget, there
 * was nowhere in Costs and payments to enter the registration cost. It lived only
 * under Edit details, at the bottom of the drawer. The fix adds ONE action to the
 * section that opens the SAME edit form on the SAME Entry fee field. No new save
 * path, no new record, no new payment logic: entry fee, gate fee and total cost
 * keep their existing form, server action and generated total.
 *
 * The help bubble was centred on its "?" button, which sits in the drawer's
 * right-hand column, so a 260px bubble ran past the drawer's right edge.
 * Verified at 1280, 820, 390 and 360 in a real browser; these guards keep the
 * pieces from drifting apart.
 * Run: node scripts/check-cost-entry.js
 */
const fs = require("fs");
let n = 0, bad = 0;
const eq = (l, a, b = true) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${l}${ok ? "" : `\n        expected ${JSON.stringify(b)}\n        actual   ${JSON.stringify(a)}`}`); };
const tc = fs.readFileSync("components/TournamentClient.js", "utf8");
const volt = fs.readFileSync("app/volt.css", "utf8");
const costs = tc.slice(tc.indexOf('id="section-costs"'), tc.indexOf('id="section-contact"'));

console.log("\nCosts and payments has an add/edit registration cost action\n");
eq("the whole action sits inside one write-permission gate, so read-only users never see it",
  /\{canWrite && \(\s*<div className="t-cost-action">[\s\S]*?Add registration cost[\s\S]*?Edit registration cost[\s\S]*?<\/div>\s*\)\}/.test(costs), true);
eq("Add registration cost shows when no fee has been entered; Edit registration cost once any exists",
  /t\.entry_fee == null && t\.gate_fee == null \? \([\s\S]*?Add registration cost[\s\S]*?\) : \([\s\S]*?Edit registration cost/.test(costs), true);
eq("the empty state says so plainly, with no warning styling", /<p className="field-note">No registration cost entered yet\.<\/p>/.test(costs) && !/alert/.test(costs.slice(costs.indexOf("t-cost-action"), costs.indexOf("t-cost-action") + 600)), true);
eq("it is independent of the budget: placed after the budget block, not inside it (works budget-first or tournament-first)",
  [costs.indexOf("t-cost-action") > costs.indexOf("Change budget line"), costs.indexOf("t-cost-action") > costs.indexOf("Choose a budget line")], [true, true]);
eq("both labels call the one onEditCost handler", (costs.match(/onClick=\{onEditCost\}/g) ?? []).length, 2);
eq("the drawer takes onEditCost and the page passes it", [/onEdit, onEditCost,/.test(tc), /onEditCost=\{\(\) => \{[^}]*setEditFocus\("entry_fee"\);[^}]*setEditing\(detail\)/.test(tc)], [true, true]);
eq("it opens the same edit form, not a new one", /setEditFocus\("entry_fee"\);\s*setEditing\(detail\)/.test(tc), true);
eq("the focus request is forgotten when the form closes", /useEffect\(\(\) => \{ if \(!editing\) setEditFocus\(null\); \}, \[editing\]\)/.test(tc), true);
eq("the form puts the cursor in the existing Entry fee field",
  [/focusField = null/.test(tc), /<input id="entry_fee" name="entry_fee"[^>]*autoFocus=\{focusField === "entry_fee"\}/.test(tc), /focusField=\{editFocus\}/.test(tc)], [true, true, true]);

console.log("\nNo new money logic\n");
eq("the only server write for a tournament is still updateTournament, called from one place",
  (tc.match(/updateTournament/g) ?? []).length, 2);
eq("the cost fields, total preview and generated total are unchanged",
  [/name="entry_fee" type="number" min="0" step="0.01"/.test(tc), /name="gate_fee" type="number" min="0" step="0.01"/.test(tc), /calculated from entry \+ gate/.test(tc)], [true, true, true]);
eq("no new import of finance or payment actions in the drawer", /from "\.\.\/lib\/actions\/finance"/.test(tc), false);
eq("the existing cost rows and the link to payments are kept",
  [/<Row label="Entry fee"/.test(costs), /<Row label="Gate fee"/.test(costs), /<Row label="Total cost"/.test(costs), /See what we&rsquo;ve paid for this tournament/.test(costs)], [true, true, true, true]);
eq("Edit details at the bottom of the drawer still exists", /onClick=\{onEdit\} disabled=\{pending\}>Edit details/.test(tc), true);

eq("opening from the cost action selects the current Entry fee so typing replaces it",
  /focusField === "entry_fee"\)\s*document\.getElementById\("entry_fee"\)\?\.select\(\)/.test(tc), true);

console.log("\nThe Registration & payment help stays inside the drawer\n");
const rule = (sel) => (volt.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`)) ?? [])[1] ?? "";
eq("the status label is the bubble's anchor", /html\.volt \.drawer-head \.t-status label \{ position: relative; \}/.test(volt), true);
eq("the ? button no longer anchors it", /position:\s*static/.test(rule("html.volt .drawer-head .t-status .helptip")), true);
const b = rule("html.volt .drawer-head .t-status .helptip-bubble");
eq("the bubble hangs from the column's right edge and grows leftward, never past the drawer",
  [/right:\s*0/.test(b), /left:\s*auto/.test(b), /transform:\s*none/.test(b), /width:\s*min\(260px,\s*calc\(100vw - 48px\)\)/.test(b)], [true, true, true, true]);
eq("the explanation wraps as normal body text instead of inheriting the label's no-wrap mono style",
  [/white-space:\s*normal/.test(b), /overflow-wrap:\s*break-word/.test(b), /font-family:\s*var\(--font-body\)/.test(b)], [true, true, true]);

console.log(`\n${n} assertions, ${bad} failed`);
process.exit(bad ? 1 : 0);
