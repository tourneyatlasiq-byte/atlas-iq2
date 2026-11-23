/**
 * Player dues schedules: the rules (2026-11).
 *
 * Pure arithmetic, no database. Every case is a sentence from the approved
 * proposal. Money is integer cents throughout.
 *
 * Run:  node scripts/check-dues-schedule.js
 */
const path = require("path");
let rules;
try {
  // lib files are ES modules; load through a tiny transform so this script stays dependency free.
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "dues-schedule.js"), "utf8")
    .replace(/export\s+function\s+/g, "function ")
    .replace(/export\s+const\s+/g, "const ");
  const names = [...src.matchAll(/^(?:function|const)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  rules = new Function(`${src}\nreturn { ${names.join(", ")} };`)();
} catch (e) {
  console.log("  FAIL  lib/dues-schedule.js could not be loaded:", e.message);
  process.exit(1);
}
const { templateTotalCents, templateFitsPlayer, allocateCredits, duesStanding, summarizeDues, validateScheduleDraft, nextMidnightDelayMs } = rules;

let ran = 0, failures = 0;
function ok(label, actual, expected) {
  ran += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
  } else console.log(`  ok    ${label}`);
}

const D = (c) => c * 100;
const std = [
  { position: 1, dueDate: "2026-12-01", amountCents: D(300) },
  { position: 2, dueDate: "2027-01-01", amountCents: D(300) },
  { position: 3, dueDate: "2027-02-01", amountCents: D(300) },
  { position: 4, dueDate: "2027-03-01", amountCents: D(300) },
];
const stand = (over) => duesStanding({ totalCents: D(1200), creditedCents: 0, exempt: false, installments: std, today: "2027-02-10", ...over });

console.log("\nChris's team schedule: exact amounts, past months included (today Nov 23, 2026)\n");
const chrisItems = [["2026-09-01", 1100], ["2026-10-01", 500], ["2026-11-01", 500], ["2026-12-01", 500], ["2027-01-01", 500], ["2027-02-01", 500]]
  .map(([dueDate, d], i) => ({ position: i + 1, dueDate, amountCents: D(d) }));
const chris = (credited, today = "2026-11-23", total = D(3600)) => duesStanding({ totalCents: total, creditedCents: credited, exempt: false, installments: chrisItems, today });
ok("the schedule totals $3,600", templateTotalCents(chrisItems), D(3600));
ok("it fits a player owing $3,600", templateFitsPlayer(chrisItems, D(3600)), true);
ok("it does not fit a player owing $3,000 (needs an individual schedule)", templateFitsPlayer(chrisItems, D(3000)), false);
ok("$1,500 recorded covers September fully, then $400 of October", chris(D(1500)).rows.map((r) => r.paidCents), [D(1100), D(400), 0, 0, 0, 0]);
ok("what is left on each installment", chris(D(1500)).rows.map((r) => r.remainingCents), [0, D(100), D(500), 0 + D(500), D(500), D(500)]);
ok("past due: $100 left on October plus November's $500", chris(D(1500)).pastDueCents, D(600));
ok("oldest past due date is October 1", chris(D(1500)).oldestPastDueDate, "2026-10-01");
ok("the next scheduled payment is December, separate from the past due", chris(D(1500)).nextScheduled, { amountCents: D(500), dueDate: "2026-12-01", dueToday: false });
ok("remaining balance is dues minus payments", chris(D(1500)).remainingCents, D(2100));
ok("nothing recorded yet: September, October and November are all past due", chris(0).pastDueCents, D(2100));
ok("a player who has paid nothing and whose schedule starts in the future is not past due", duesStanding({ totalCents: D(3600), creditedCents: 0, exempt: false, installments: chrisItems, today: "2026-08-15" }).pastDueCents, 0);
ok("payments only ever cover the calculation: credited equals covered plus uncovered", (() => { const s = chris(D(1500)); return s.rows.reduce((a, r) => a + r.paidCents, 0); })(), D(1500));
ok("payments beyond the past installments spill forward, oldest first", chris(D(2700)).rows.map((r) => r.paidCents), [D(1100), D(500), D(500), D(500), D(100), 0]);
ok("covered everything through today: on track, next is the first unpaid", [chris(D(2100)).status, chris(D(2100)).nextScheduled.dueDate], ["on-track", "2026-12-01"]);

console.log("\nCredits apply to the oldest installment first\n");
ok("no credit", allocateCredits(std, 0).map((r) => r.remainingCents), [D(300), D(300), D(300), D(300)]);
ok("one and a half installments", allocateCredits(std, D(450)).map((r) => r.remainingCents), [0, D(150), D(300), D(300)]);
ok("overpayment leaves every installment paid", allocateCredits(std, D(2000)).map((r) => r.remainingCents), [0, 0, 0, 0]);
ok("installments are applied in date order whatever order they arrive", allocateCredits([std[2], std[0], std[1], std[3]], D(300)).map((r) => [r.dueDate, r.remainingCents]),
  [["2026-12-01", 0], ["2027-01-01", D(300)], ["2027-02-01", D(300)], ["2027-03-01", D(300)]]);

console.log("\nThe approved preview figures (as of Feb 10)\n");
const ella = stand({ creditedCents: D(1050) });
ok("Ella early payment: due by today", ella.dueByTodayCents, 0);
ok("Ella past due", ella.pastDueCents, 0);
ok("Ella remaining", ella.remainingCents, D(150));
ok("Ella next scheduled payment", ella.nextScheduled, { amountCents: D(150), dueDate: "2027-03-01", dueToday: false });
ok("Ella status", ella.status, "on-track");

const nora = duesStanding({ totalCents: D(1200), creditedCents: D(600), exempt: false, today: "2027-02-10",
  installments: [{ position: 1, dueDate: "2026-12-01", amountCents: D(600) }, { position: 2, dueDate: "2027-03-01", amountCents: D(600) }] });
ok("Nora custom 50/50: nothing past due", nora.pastDueCents, 0);
ok("Nora next scheduled payment", nora.nextScheduled, { amountCents: D(600), dueDate: "2027-03-01", dueToday: false });

const zoe = stand({ creditedCents: D(450) });
ok("Zoe past due", zoe.pastDueCents, D(450));
ok("Zoe due by today", zoe.dueByTodayCents, D(450));
ok("Zoe remaining", zoe.remainingCents, D(750));
ok("Zoe oldest past due date", zoe.oldestPastDueDate, "2027-01-01");
ok("Zoe next scheduled payment is separate from what is overdue", zoe.nextScheduled, { amountCents: D(300), dueDate: "2027-03-01", dueToday: false });
ok("Zoe status", zoe.status, "past-due");
ok("Zoe installment states", zoe.rows.map((r) => r.state), ["paid", "past-due", "past-due", "upcoming"]);
ok("Zoe Jan installment is partly paid", zoe.rows[1].partial, true);
ok("Zoe Jan installment has $150 left", zoe.rows[1].remainingCents, D(150));

console.log("\nDue today is due, and past due the next day\n");
const mia = stand({ creditedCents: D(600), today: "2027-02-01" });
ok("Feb 1 installment due today: due by today", mia.dueByTodayCents, D(300));
ok("Feb 1 installment due today: not past due", mia.pastDueCents, 0);
ok("Feb 1 installment due today: it is the next scheduled payment", mia.nextScheduled, { amountCents: D(300), dueDate: "2027-02-01", dueToday: true });
ok("Feb 1 installment due today: status", mia.status, "due-today");
const nextDay = stand({ creditedCents: D(600), today: "2027-02-02" });
ok("the next day it is past due", nextDay.pastDueCents, D(300));
ok("the next day the next scheduled payment moves on", nextDay.nextScheduled, { amountCents: D(300), dueDate: "2027-03-01", dueToday: false });
ok("a paid installment due today is not shown as owing", stand({ creditedCents: D(900), today: "2027-02-01" }).status, "on-track");

console.log("\nPartial, early, split and over payments never count twice\n");
const parts = [D(100), D(100), D(100)].reduce((a, b) => a + b, 0);
ok("three split payments equal one payment of the same total", stand({ creditedCents: parts }).pastDueCents, stand({ creditedCents: D(300) }).pastDueCents);
ok("paying ahead of schedule reduces later installments", stand({ creditedCents: D(900), today: "2026-12-15" }).nextScheduled.amountCents, D(300));
ok("early payment covers the next installment too: nothing due, next is later", stand({ creditedCents: D(600), today: "2026-12-15" }).nextScheduled,
  { amountCents: D(300), dueDate: "2027-02-01", dueToday: false });
ok("past due never goes below zero when overpaid", stand({ creditedCents: D(5000) }).pastDueCents, 0);
ok("overpaid player is paid", stand({ creditedCents: D(5000) }).status, "paid");
ok("overpaid amount is reported separately", stand({ creditedCents: D(1300) }).overpaidCents, D(100));
ok("paid in full: no next scheduled payment", stand({ creditedCents: D(1200) }).nextScheduled, null);
ok("rounding: three installments of $333.33/$333.33/$333.34", duesStanding({ totalCents: 100000, creditedCents: 33333, exempt: false, today: "2027-01-02",
  installments: [{ position: 1, dueDate: "2026-12-01", amountCents: 33333 }, { position: 2, dueDate: "2027-01-01", amountCents: 33333 }, { position: 3, dueDate: "2027-02-01", amountCents: 33334 }] }).pastDueCents, 33333);

console.log("\nPlayers without a schedule, exempt players and zero dues\n");
const none = duesStanding({ totalCents: D(1200), creditedCents: D(300), exempt: false, installments: [], today: "2027-02-10" });
ok("no schedule: status", none.status, "no-schedule");
ok("no schedule: never reported past due", none.pastDueCents, 0);
ok("no schedule: balance still shown", none.remainingCents, D(900));
ok("exempt: status", duesStanding({ totalCents: 0, creditedCents: 0, exempt: true, installments: [], today: "2027-02-10" }).status, "exempt");
ok("exempt ignores any leftover rows", duesStanding({ totalCents: 0, creditedCents: 0, exempt: true, installments: std, today: "2027-02-10" }).pastDueCents, 0);
ok("zero dues: status", duesStanding({ totalCents: 0, creditedCents: 0, exempt: false, installments: [], today: "2027-02-10" }).status, "no-dues");
ok("schedule that does not add up is reported, not trusted", duesStanding({ totalCents: D(1000), creditedCents: 0, exempt: false, installments: std, today: "2027-02-10" }).status, "schedule-mismatch");
ok("mismatch reports no past due claim", duesStanding({ totalCents: D(1000), creditedCents: 0, exempt: false, installments: std, today: "2027-02-10" }).pastDueCents, 0);

console.log("\nBefore the device date is known\n");
const loading = duesStanding({ totalCents: D(1200), creditedCents: D(450), exempt: false, installments: std, today: null });
ok("status is neutral", loading.status, "loading");
ok("no past due is claimed", loading.pastDueCents, null);
ok("no next payment is claimed", loading.nextScheduled, null);
ok("the plain balance is still available", loading.remainingCents, D(750));
ok("summary without a date reports nothing", summarizeDues([loading]).ready, false);

console.log("\nTeam summary\n");
const sum = summarizeDues([zoe, mia, ella, nora, none, duesStanding({ totalCents: 0, creditedCents: 0, exempt: true, installments: [], today: "2027-02-01" })]);
ok("summary is ready once the date is known", sum.ready, true);
ok("players past due", sum.pastDueCount, 1);
ok("past due total", sum.pastDueCents, D(450));
ok("players due today", sum.dueTodayCount, 1);
ok("without a schedule", sum.noScheduleCount, 1);

console.log("\nThe schedule editor\n");
const row = (d, a) => ({ dueDate: d, amount: a });
ok("matching total is accepted", validateScheduleDraft({ totalCents: D(1000), paidCents: D(450), rows: [row("2026-12-01", "250"), row("2027-01-01", "250"), row("2027-02-01", "250"), row("2027-03-01", "250")] }).ok, true);
const over = validateScheduleDraft({ totalCents: D(1000), paidCents: 0, rows: [row("2026-12-01", "300"), row("2027-01-01", "300"), row("2027-02-01", "300"), row("2027-03-01", "300")] });
ok("installments over the total are refused", [over.ok, over.diffCents], [false, D(200)]);
ok("installments under the total are refused", validateScheduleDraft({ totalCents: D(1000), paidCents: 0, rows: [row("2026-12-01", "500")] }).diffCents, -D(500));
ok("duplicate dates are refused", validateScheduleDraft({ totalCents: D(1000), paidCents: 0, rows: [row("2026-12-01", "500"), row("2026-12-01", "500")] }).ok, false);
ok("a blank date is refused", validateScheduleDraft({ totalCents: D(1000), paidCents: 0, rows: [row("", "1000")] }).ok, false);
ok("zero amount is refused", validateScheduleDraft({ totalCents: D(1000), paidCents: 0, rows: [row("2026-12-01", "1000"), row("2027-01-01", "0")] }).ok, false);
ok("a total below what is already paid is refused", validateScheduleDraft({ totalCents: D(400), paidCents: D(450), rows: [row("2026-12-01", "400")] }).ok, false);
ok("currency formatting is accepted", validateScheduleDraft({ totalCents: D(1200), paidCents: 0, rows: [row("2026-12-01", "$1,200.00")] }).ok, true);
ok("an empty schedule is allowed (clears it)", validateScheduleDraft({ totalCents: D(1200), paidCents: 0, rows: [] }).ok, true);
ok("more than 24 installments are refused", validateScheduleDraft({ totalCents: 2500, paidCents: 0, rows: Array.from({ length: 25 }, (_, i) => row(`2027-01-${String(i + 1).padStart(2, "0")}`, "1")) }).ok, false);

console.log("\nWhen the day changes\n");
const at = (s) => new Date(s);
ok("one hour before midnight", nextMidnightDelayMs(at("2027-02-10T23:00:00")), 3600 * 1000 + 1000);
ok("at midnight the next check is a day away", nextMidnightDelayMs(at("2027-02-11T00:00:00")), 24 * 3600 * 1000 + 1000);
ok("delay never exceeds the timer limit", nextMidnightDelayMs(at("2027-02-10T12:00:00")) <= 2 ** 31 - 1, true);

console.log(`\n${ran - failures}/${ran} passed${failures ? `, ${failures} FAILED` : ""}\n`);
process.exit(failures ? 1 : 0);
