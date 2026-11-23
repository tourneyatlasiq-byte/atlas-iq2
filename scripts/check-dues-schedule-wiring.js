/**
 * Structure checks for the dues-schedule feature that tests of the rules cannot see:
 * no blue, nothing here writes payment_log, the screens refuse to guess before the
 * device date is known, and the app tolerates the migration not being applied yet.
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let ran = 0, failed = 0;
function ok(label, cond) { ran += 1; if (!cond) { failed += 1; console.log(`  FAIL  ${label}`); } else console.log(`  ok    ${label}`); }

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ui = stripComments(read("components/DuesSchedule.js"));
const css = read("app/volt.css");
const dsCss = css.slice(css.indexOf("Player dues schedules (2026-11)"));
const actions = stripComments(read("lib/actions/dues-schedule.js"));
const query = read("lib/queries/dues-schedule.js");
const hook = read("components/useDeviceToday.js");
const fin = read("components/FinanceClient.js");
const page = read("app/(app)/finance/page.js");
const mig = read("supabase/migrations/20261123223848_player_dues_schedules.sql");

ok("schedule styles use no blue token or blue hex", !/var\(--info|var\(--blue|#1d5fd1|#2563eb|#3b82f6|#1a73e8/i.test(dsCss));
ok("schedule styles use the approved Volt tokens", /var\(--volt\)/.test(dsCss) && /var\(--owed/.test(dsCss) && /var\(--paid/.test(dsCss) && /var\(--due/.test(dsCss));
ok("every schedule checkbox gets the ink accent (browsers default to blue)", /\.ds-pick label input[^}]*accent-color:\s*#0c0f14/.test(dsCss) && /\.ds-replace input[^}]*\n?[^}]*accent-color:\s*#0c0f14/.test(dsCss) || /\.ds-exempt input[^}]*accent-color:\s*#0c0f14/.test(dsCss));
ok("apply sends the team schedule revision that was reviewed", /expected_revision:\s*preview\.revision/.test(ui) && /p_expected_revision/.test(actions));
ok("a changed team schedule sends the person back to review (template_changed handled)", /template_changed/.test(ui));
ok("the player editor starts from one snapshot of values and version, not page data", /loadDuesSnapshot/.test(ui) && !/loadDuesVersion/.test(ui + actions) && !/useState\(\(cents\(p\.totalDue\)/.test(ui));
ok("the editor does not read amounts from the page's player record", !/p\.totalPaid/.test(ui.slice(ui.indexOf("export function ChangeScheduleSheet"))));
ok("the drawer record button names no amount", /Record payment/.test(fin) && !/Record \{money\(p\.balance\)\}[\s\S]{0,40}<\/button>\s*\)\}\s*<\/div>\s*\)\}\s*<\/DrawerShell>/.test(fin));
ok("the old Total/Paid/Balance block is hidden when the schedule summary shows", /!\(standing && standing\.hasSchedule\)/.test(fin));
ok("no pill-registered (blue) class used by the schedule screens", !/pill-registered/.test(ui));
ok("the future amount is labelled 'Next scheduled payment'", /Next scheduled payment/.test(ui));
ok("the old 'Next payment' label is not used", !/"Next payment"|>Next payment</.test(ui));
ok("no schedule action or screen writes payment_log", !/payment_log/.test(actions) && !/payment_log/.test(ui) && !/recordPayment|record_player_payment/.test(actions));
ok("the apply function writes installments only", !/insert into public\.payment_log|update public\.payment_log|delete from public\.payment_log/i.test(mig));
ok("the migration never deletes or rewrites history", !/delete from public\.dues_installments/i.test(mig));
ok("device date is null until the browser reports it", /useState\(null\)/.test(hook));
ok("the device date refreshes on day change and on app resume", /nextMidnightDelayMs/.test(hook) && /visibilitychange/.test(hook) && /pageshow/.test(hook));
ok("Apply is disabled until the date is known", /disabled=\{busy \|\| !today\}/.test(ui));
ok("the list shows no past-due claim before the date is known", /today \? roster\.filter\(isPastDue\)\.length : "…"/.test(fin) && /view === "pastdue"\) return today \? isPastDue\(r\) : false/.test(fin));
ok("Finance loads if the schedule tables are missing", /available: false/.test(query) && /catch/.test(query) && /listDuesSchedules/.test(page));
ok("the review sheet separates actual payments from calculated coverage", /Recorded payments \(actual\)/.test(ui) && /Schedule coverage \(calculated\)/.test(ui) && /Covered by calculation/.test(ui));
ok("applying states that no payment is created or changed", /does not create a payment/.test(ui));
ok("a repeat submission reuses one key per review", /batchKey = useRef/.test(ui));
ok("old total-edit path refuses scheduled players in plain words", /payment schedule, so their total and schedule have to change together/.test(read("lib/actions/finance.js")));
ok("the older bulk edit refuses when any player has a schedule", /can no longer be reallocated as a group/.test(read("lib/actions/finance.js")));
ok("the dues-schedule actions are marked server-only", /^"use server"/.test(read("lib/actions/dues-schedule.js")));
console.log(`\n${ran - failed}/${ran} passed${failed ? `, ${failed} FAILED` : ""}\n`);
process.exit(failed ? 1 : 0);
