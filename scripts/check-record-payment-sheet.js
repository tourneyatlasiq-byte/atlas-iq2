/**
 * Record payment sheet: a partial payment must be one clear step on a phone.
 *
 * Found with Chris (2026-11-23): the sheet opened with the full balance already typed in
 * the field. Tapping it puts the cursor at the END, so typing 500 produced "2100.00500"
 * and a button reading "Record $2,100.01". With every label showing the full balance,
 * it looked as if only the full balance could be recorded.
 *
 * The behavioural proof (a real tap and keystrokes at 390px) is scripts/e2e-record-payment.js.
 * These checks keep the structure from drifting back.
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let ran = 0, failed = 0;
function ok(label, cond) { ran += 1; if (!cond) { failed += 1; console.log(`  FAIL  ${label}`); } else console.log(`  ok    ${label}`); }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sheet = strip(read("components/RecordPaymentSheet.js"));
const fin = strip(read("components/FinanceClient.js"));
const dash = strip(read("components/DashboardClient.js"));

ok("the amount field starts empty, never pre-typed with the balance", /useState\(""\)/.test(sheet) && !/useState\(balance > 0 \? balance\.toFixed/.test(sheet));
ok("focusing the amount selects what is in it, so typing replaces rather than appends", /onFocus=\{\(e\) => e\.target\.select\(\)\}/.test(sheet));
ok("the field is labelled as the amount being recorded", /Amount to record/.test(sheet));
ok("the balance block is labelled Remaining balance", /Remaining balance/.test(sheet));
ok("the sheet shows what will be left after the entered amount", /left after this payment/.test(sheet) && /Paid in full with this payment/.test(sheet));
ok("full balance stays available as one tap", /Full balance/.test(sheet));
ok("the save button names the entered amount, not the balance", /Record \$\{money\(a\)\}/.test(sheet) && !/Record \$\{money\(balance\)\}/.test(sheet));
ok("amount field is a decimal keypad field", /inputMode="decimal"/.test(sheet));
ok("date field is present and defaults to today", /id="rp-date"/.test(sheet) && /useState\(todayIso\(\)\)/.test(sheet));
ok("payment rules and idempotency untouched", /request_key: key\.current/.test(sheet) && /expected_paid: p\.totalPaid/.test(sheet));

ok("no entry point labels its button with the remaining balance (Finance)", !/Record \{money\(p\.balance\)\}/.test(fin));
ok("no entry point labels its button with the remaining balance (Dashboard)", !/Record \{money\(p\.balance\)\}/.test(dash));
ok("the drawer button reads Record payment", /Record payment\s*<\/button>/.test(fin));

console.log(`\n${ran - failed}/${ran} passed`);
process.exit(failed ? 1 : 0);
