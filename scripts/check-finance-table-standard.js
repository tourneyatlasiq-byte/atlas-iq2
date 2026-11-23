// Finance table standard (2026-11): source-level checks so the rules cannot drift back.
const fs = require("fs");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error("FAIL:", m); } else console.log("ok:", m); };
// Install order: this package sits on top of the optional budgeting package.
ok(fs.existsSync("lib/tournament-cost.js") && fs.existsSync("scripts/check-optional-budget.js"),
  "optional budgeting package is installed first (lib/tournament-cost.js and scripts/check-optional-budget.js present)");
const fc = fs.readFileSync("components/FinanceClient.js", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");
const volt = fs.readFileSync("app/volt.css", "utf8");

// Budget category rows (table figures) use money(), never whole-dollar summaryMoney
for (const expr of ["summaryMoney(g.budgeted)", "summaryMoney(g.paidTotal)", "summaryMoney(g.toPay)", "summaryMoney(g.available)", "summaryMoney(gp.remaining)", "summaryMoney(seasonPool.amount)", "summaryMoney(0)"])
  ok(!fc.includes(expr), `table figure no longer uses ${expr}`);
ok(/data-label="Budget"|data-label=\{income \? "Goal"/.test(fc) && fc.includes("{money(g.budgeted)}"), "category Budget cell uses money()");
ok(!/<span className="muted">\$0<\/span>/.test(fc), "no literal $0 in Player Dues balance cells");
ok(fc.includes('<th className="th-num">Amount</th>'), "Transactions Amount header is right-aligned");
// Headline tiles keep whole-dollar summary formatting
ok(fc.includes("function summaryMoney"), "summaryMoney kept for headline tiles");
// CSS rules
ok(/--table-band:\s*#f8f9fb/.test(css), "band token defined");
ok(/\.txn-table tbody tr:nth-child\(even\)/.test(css) && /\.pay-table tbody tr:nth-child\(even\)/.test(css), "zebra on Transactions and Player Dues");
ok(/\.budget-group \.budget-line:nth-of-type\(even\)/.test(css), "zebra on Budget lines");
ok(/\.th-num[^{]*\{\s*text-align:\s*right/.test(css), "numeric header alignment rule");
ok(/112px;\s*\/\* line-row actions/.test(css), "budget actions track is fixed width (no per-row drift)");
ok(!/\.budget-num, html:root \.t-cost/.test(volt), "Volt no longer disables tabular digits on table figures");
process.exit(fail ? 1 : 0);
