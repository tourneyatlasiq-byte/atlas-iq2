/**
 * The player-selection step of the team dues schedule (Chris, 2026-11-23).
 * Structure checks: it is reachable without re-saving the template, it is labeled as a
 * step, it lists every player with the reason anyone is skipped, and it can select all and clear.
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let ran = 0, failed = 0;
function ok(label, cond) { ran += 1; if (!cond) { failed += 1; console.log(`  FAIL  ${label}`); } else console.log(`  ok    ${label}`); }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ui = strip(read("components/DuesSchedule.js"));
const fin = strip(read("components/FinanceClient.js"));
const css = read("app/volt.css");
const apply = ui.slice(ui.indexOf("export function ApplyScheduleSheet"), ui.indexOf("export function ", ui.indexOf("export function ApplyScheduleSheet") + 10));

ok("Finance has an Apply button of its own when a team schedule exists", /onApplySchedule/.test(fin) && /Apply schedule to players/.test(fin));
ok("that button opens the apply sheet directly", /onApplySchedule=\{\(\) => \{ setApplyJustSaved\(false\); setApplyOpen\(true\); \}\}/.test(fin));
ok("plain save says where to go next", /Choose players from the Apply schedule button/.test(ui));
ok("the apply sheet is labeled Step 1 of 2", /Step 1 of 2/.test(apply) && /Choose players/.test(apply));
ok("the review is labeled Step 2 of 2", /Step 2 of 2/.test(apply));
ok("every player is listed, none hidden behind a footnote", !/not listed because they owe no dues/.test(apply));
ok("exempt players show why they are skipped", /Exempt/.test(apply));
ok("$0-dues players show why they are skipped", /Owes no dues/.test(apply));
ok("different-total players show their own total in the reason", /Needs its own schedule/.test(apply));
ok("there is a Select all control", />Select all</.test(apply));
ok("there is a Clear control", />Clear</.test(apply));
ok("editor says + Add installment", />\+ Add installment</.test(ui) && !/Add a payment/.test(ui));
ok("editor says Schedule total, not Payments add up to", /<span>Schedule total<\/span>/.test(ui.slice(ui.indexOf("export function ChangeScheduleSheet"))) && !/Payments add up to/.test(ui));
ok("existing payments are read only and counted automatically", /Existing payments count automatically toward this schedule\./.test(ui));
ok("past due line says Past due", /Past due: <b>/.test(ui) && !/Past due today:/.test(ui));
ok("Save stays disabled for a new empty schedule", /\(exempt \|\| hadSchedule \|\| rows\.length > 0\)/.test(ui));
ok("installment fields use the rounded field style", /\.ds-edit-row input \{ border: 0; border-radius: 11px/.test(read("app/volt.css")));
ok("Select all keeps what is already selected", /setPicked\(\(cur\) => new Set\(\[\.\.\.cur,/.test(apply));
ok("going straight to choosing shows a banner in the sheet, not a toast over the list", /Team schedule saved\. Nothing has been applied yet\./.test(apply) && /if \(thenChoose\) onSavedChoosePlayers/.test(ui) && !/toast\(thenChoose/.test(ui));
ok("a schedule that fits no player says so and offers Edit team schedule", /No player can take this schedule\./.test(apply) && /Edit team schedule/.test(apply) && /onEditSchedule/.test(fin));
ok("saving a team schedule that does not match what most players owe warns", /Most players on this team owe/.test(ui) && /payments=\{payments\}/.test(fin));
ok("exempt and $0 skips use a neutral style, not the red owed colour", /ds-pick-why-neutral/.test(apply) && /ds-pick-why-neutral\s*\{\s*color:\s*var\(--muted\)/.test(css));
ok("every disabled player has a visible Not selectable reason", /Not selectable/.test(apply) && /"Skipped"/.test(apply));
ok("a new installment starts with a date", /nextDueDate\(rows\)/.test(ui) && !/\{ dueDate: "", amount: "" \}\]\)\}>\+ Add installment/.test(ui));
console.log(`${ran - failed}/${ran} checks passed`);
process.exit(failed ? 1 : 0);
