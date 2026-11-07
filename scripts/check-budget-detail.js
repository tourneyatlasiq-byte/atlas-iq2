/**
 * Season Budget Detail (2026-11) — BEHAVIOURAL, privacy and reconciliation.
 *
 *   A. reconciliation: every category's Budget/Paid/To Pay/Remaining and the
 *      season totals equal Finance (buildBudget + financeSummary, ST-011),
 *      rows sum to each category's committed and paid figures, the
 *      uncategorized section equals Finance's unassigned figure
 *   B. privacy: protected lines (report_total_only) contribute one "Other
 *      category costs" row and nothing else; player-linked expenses carry no
 *      identity; vendor, notes, IDs, links, income rows and line names never
 *      reach the payload; $0 uncategorized rows never print
 *   C. coach notes: name check, omitted-amount count, fully covered tournaments
 *   D. the page: Summary default and unchanged, toggle, privacy notice,
 *      Over budget, As of, notes collapsed, ?detail=detailed, title
 *   E. the budget-line flag: form control, Coaches default, stored flag rules,
 *      migration guards
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const React = require("react");
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/link") return { __esModule: true, default: (p) => React.createElement("a", p, p.children) };
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => null };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const { renderToStaticMarkup } = require("react-dom/server");
const { buildBudgetDetail } = require(path.join(ROOT, "lib/queries/reports/season-budget-detail.js"));
const q = require(path.join(ROOT, "lib/queries/finance.js"));
const rules = require(path.join(ROOT, "lib/finance-rules.js"));
const { SeasonBudgetReport } = require(path.join(ROOT, "components/reports/SeasonBudgetReport.js"));

const L = (id, category, budgeted, extra = {}) => ({ id, category, name: `SECRET-LINE-${id}`, budgeted, is_income: false, notes: `SECRET-NOTE-${id}`, report_total_only: false, ...extra });
let n = 0;
const T = (line, date, item, amt, status = "Paid", extra = {}) => ({ id: `txn-${++n}`, budget_item_id: line, tournament_id: null, txn_date: date, item, actual_amount: amt, status, is_income: false, player_id: null,
  vendor: "SECRET-VENDOR", notes: "SECRET-TXN-NOTE", receipt_path: "SECRET-RECEIPT", facility_id: "SECRET-FAC", quantity: 3, player: null, ...extra });
const tour = (id, line, cost, decision = "Committed", extra = {}) => ({ id, name: `Tournament ${id}`, start_date: "2026-09-12", end_date: "2026-09-13", decision, total_cost: cost, budget_item_id: line, ...extra });

const items = [L("tf", "Tournament Fees", 3000), L("eq", "Equipment", 1000), L("co", "Coaches", 1500, { report_total_only: true }), L("ot", "Other", 200),
  { id: "fr", category: "Fundraising", name: "Car wash", budgeted: 900, is_income: true }];
const tours = [tour("t1", "tf", 1000), tour("t2", "tf", 600), tour("t3", null, 500), tour("t4", null, 300), tour("t5", null, 400, "Considering")];
const txns = [
  T("tf", "2026-08-20", "Fall entry", 400, "Paid", { tournament_id: "t1" }),
  T("eq", "2026-08-21", "t2 equipment deposit", 250, "Paid", { tournament_id: "t2" }),       // ST-011: t2's money filed on Equipment
  T("eq", "2026-09-01", "Catcher gear", 300),
  T("eq", "2026-09-05", "Batting gloves", 40, "Paid", { player_id: "PLAYER-SECRET", player: { id: "PLAYER-SECRET", full_name: "Avery Rowley" } }),
  T("eq", "2026-09-06", "Bat bag", 60, "To Pay", { player_id: "PLAYER-SECRET-2", player: { full_name: "Brooke Tanaka" } }),
  T("co", "2026-09-01", "Pitching lesson with Coach Jordan Smith", 250),
  T("co", "2026-10-01", "Stipend Jordan Smith", 250, "To Pay"),
  T("eq", "2026-09-10", "Pending invoice", null, "To Pay"),
  T("ot", "2026-09-15", "Thank-you gift for Kendall Hayes", 75),
  T("eq", "2026-09-20", "t4 paid on equipment", 300, "Paid", { tournament_id: "t4" }),         // fully covers uncategorized t4
  T("ot", "2026-10-02", "Overspend", 400),
  { ...T("fr", "2026-09-30", "Car wash proceeds", 900), is_income: true },
];
const people = ["Avery Rowley", "Brooke Tanaka", "Kendall Hayes", "Jordan Smith"];

(async () => {
  const det = buildBudgetDetail({ budgetItems: items, transactions: txns, tournaments: tours, people });
  const { _check, ...payload } = det;
  const cat = (name) => payload.categories.find((c) => c.category === name);

  console.log("A. reconciliation with Finance");
  {
    const budget = q.buildBudget(items, txns, tours);
    const fin = q.financeSummary(budget, txns, []);
    const un = q.unassignedTournamentCommitments(tours, txns);
    for (const g of budget.expenses) {
      const c = cat(g.category);
      assertEq(`${g.category}: Budget, Paid, To Pay, Remaining equal Finance`,
        [c.budget, c.paid, c.toPay, c.remaining], [g.budgeted, g.paidTotal, g.toPay, g.available]);
    }
    assertEq("every category's rows sum to its committed figure, and their payments to its Paid",
      _check.categories.every((k) => rules.cents(k.rowSum) === rules.cents(k.committed) && rules.cents(k.rowPaid) === rules.cents(k.paid)), true);
    assertEq("To Pay = Committed − Paid and Remaining = Budget − Committed, per category",
      payload.categories.every((c) => rules.cents(c.toPay) === rules.cents(c.committed - c.paid) && rules.cents(c.remaining) === rules.cents(c.budget - c.committed)), true);
    const s = payload.season;
    assertEq("season Budget, Paid, To Pay, Remaining, Committed equal Finance",
      [s.budget, s.paid, s.toPay, s.remaining, s.committed], [fin.budgetedExpenses, fin.actualExpenses, fin.toPay, fin.availableBudget, fin.committedExpenses]);
    assertEq("categories add up to the season", ["budget", "paid", "toPay", "remaining", "committed"].map((k) => rules.cents(rules.sumMoney(payload.categories.map((c) => c[k])))),
      [fin.budgetedExpenses, fin.actualExpenses, fin.toPay, fin.availableBudget, fin.committedExpenses].map(rules.cents));
    const unTotal = rules.sumMoney(un.map((u) => u.amount));
    assertEq("uncategorized section equals Finance's unassigned figure, Projected = Remaining − it",
      [s.unassignedTotal, s.projectedRemaining], [unTotal, rules.sumMoney([fin.availableBudget, -unTotal])]);
    const t2 = cat("Tournament Fees").rows.find((r) => r.name === "Tournament t2");
    assertEq("ST-011: t2 on Tournament Fees holds only what Equipment hasn't recorded ($600 − $250)", t2?.amount, 350);
    assertEq("ST-011: t2's $250 stays on Equipment, as an ordinary expense row", cat("Equipment").rows.some((r) => r.description === "t2 equipment deposit" && r.amount === 250), true);
    const t1 = cat("Tournament Fees").rows.find((r) => r.name === "Tournament t1");
    assertEq("same-line: t1 $1,000 with $400 paid on its line reads Part paid, its transaction folded in",
      [t1?.amount, t1?.status, cat("Tournament Fees").rows.some((r) => r.description === "Fall entry")], [1000, "Part paid", false]);
    assertEq("Considering tournaments never appear", JSON.stringify(payload).includes("Tournament t5"), false);
  }

  console.log("B. privacy");
  {
    const json = JSON.stringify(payload);
    assertEq("a protected line contributes one 'Other category costs' row and nothing else",
      cat("Coaches").rows, [{ kind: "other", label: "Other category costs", amount: 500, status: "Part paid" }]);
    assertEq("no protected transaction's description, date or recipient reaches the payload",
      [/Pitching lesson|Stipend|Jordan Smith/.test(json), /2026-10-01/.test(JSON.stringify(cat("Coaches")))], [false, false]);
    assertEq("player-linked expenses become one 'Player-specific costs' row, without identity",
      [cat("Equipment").rows.filter((r) => r.kind === "player").map((r) => [r.label, r.amount, r.status])[0], /PLAYER-SECRET|Avery Rowley|Brooke Tanaka|Batting gloves|Bat bag/.test(json)],
      [["Player-specific costs", 100, "Part paid"], false]);
    assertEq("vendor, notes, receipts, quantities, facility links and line names never reach the payload",
      /SECRET-VENDOR|SECRET-TXN-NOTE|SECRET-RECEIPT|SECRET-FAC|SECRET-LINE|SECRET-NOTE|"quantity"|"vendor"|"notes"/.test(json), false);
    assertEq("no IDs of any kind reach the payload", /"id"|txn-\d|"t[0-9]"|"tf"|"eq"|"co"|"ot"/.test(json), false);
    assertEq("income transactions never print", /Car wash proceeds/.test(json), false);
    assertEq("transactions with no amount never print", /Pending invoice/.test(json), false);
    assertEq("only allowed row fields exist",
      [...new Set(payload.categories.flatMap((c) => c.rows.flatMap((r) => Object.keys(r))))].sort(),
      ["amount", "date", "description", "endDate", "kind", "label", "name", "startDate", "status"]);
    assertEq("uncategorized section shows only outstanding amounts (no $0 rows): t3 $500; t4 fully covered is absent",
      payload.unassigned.map((u) => [u.name, u.amount]), [["Tournament t3", 500]]);
  }

  console.log("C. coach-only notes");
  assertEq("name check flags printed descriptions mentioning someone, by date and amount only",
    payload.coach.nameMatches, [{ date: "2026-09-15", amount: 75 }]);
  assertEq("omitted transactions without an amount are counted", payload.coach.omittedNoAmount, 1);
  assertEq("a fully covered uncategorized tournament is a coach note, not a parent row", payload.coach.fullyCoveredUncategorized, 1);

  console.log("D. the page");
  {
    const report = { generatedAt: "2026-11-07T15:00:00Z", organization: { name: "Bramblewood Fastpitch", logoUrl: null }, team: { name: "Bramblewood 14U Gold" },
      season: { name: "2026-27" }, totalBudget: 5700, allocation: { total: 5700, categories: [{ category: "Tournament Fees", budgeted: 3000, percent: 53 }] },
      dues: { perPlayer: 975 }, otherIncome: { total: 900, lines: [{ name: "Car wash", budgeted: 900 }] }, blocked: false,
      warnings: [{ blocking: false, title: "Individual dues arrangements", message: "1 player has an individual arrangement that isn't shown." }] };
    const render = (props) => renderToStaticMarkup(React.createElement(SeasonBudgetReport, { report, ...props }));
    const before = renderToStaticMarkup(React.createElement(SeasonBudgetReport, { report }));
    const sum = render({ detail: payload });
    const dt = render({ detail: payload, initialDetail: "detailed" });
    const art = (h) => h.slice(h.indexOf("<article"));
    assertEq("Summary is the default", /aria-pressed="true"[^>]*>Summary</.test(sum), true);
    assertEq("Summary's document is unchanged by the Detailed work", art(sum), art(before));
    assertEq("Detailed: Season Budget Detail, As of <date>, toolbar name follows",
      [/<h1 class="rpt-doc-title">Season Budget Detail<\/h1>/.test(dt), /2026-27 season · As of November 7, 2026/.test(dt), /<p class="rpt-tb-name">Season Budget Detail<\/p>/.test(dt)], [true, true, true]);
    assertEq("the privacy notice is visible in Detailed, never collapsed, never in Summary",
      [/<p class="rpt-privacy" role="note">Detailed shows each expense&#x27;s date, description and amount to families\. Descriptions print exactly as entered in Finance\. Review them before sharing\.<\/p>/.test(dt.replace(/’/g, "&#x27;")), /rpt-privacy/.test(sum)], [true, false]);
    assertEq("...and it sits in the screen-only toolbar", /<div class="rpt-bar rpt-no-print">[\s\S]*rpt-privacy[\s\S]*<article/.test(dt), true);
    assertEq("Detailed notes join the collapsed report notes (summary note + 3 detailed notes)", /4 report notes \(2 to check\) · View details/.test(dt), true);
    assertEq("the omitted-amount note is there, without any description text",
      [/1 transaction has no amount yet and isn&#x27;t shown\./.test(dt), /Pending invoice/.test(dt)], [true, false]);
    {
      const tf = cat("Tournament Fees"); const m = (v) => rules.money(v);
      assertEq("category figures read Budget, Paid, To Pay, Remaining, from the payload",
        art(dt).replace(/<!-- -->/g, "").includes(`<span>Budget ${m(tf.budget)}</span><span>Paid ${m(tf.paid)}</span><span>To Pay ${m(tf.toPay)}</span><span>Remaining ${m(tf.remaining)}</span>`), true);
    }
    assertEq("an over-budget category reads 'Over budget $X', never a negative Remaining",
      [/Remaining <span class="bd-over">Over budget \$275\.00<\/span>/.test(art(dt).replace(/<!-- -->/g, "")), /Remaining -\$|Remaining \$-/.test(art(dt).replace(/<!-- -->/g, ""))], [true, false]);
    assertEq("dues and fundraising cards are the Summary's", [/\$975/.test(art(dt)), /Car wash/.test(art(dt))], [true, true]);
    assertEq("the parent note prints in Detailed too", /<p class="rpt-note">Pay by Sep 15\.<\/p>/.test(render({ detail: payload, initialDetail: "detailed", initialNote: "Pay by Sep 15." })), true);
    assertEq("no detail payload (e.g. blocked): no toggle, Summary only", /rpt-seg/.test(render({})), false);
    const page = fs.readFileSync(path.join(ROOT, "app/reports/season-budget/page.js"), "utf8");
    const comp = fs.readFileSync(path.join(ROOT, "components/reports/SeasonBudgetReport.js"), "utf8");
    assertEq("?detail=detailed opens Detailed; the PDF name follows", [/searchParams\?\.detail === "detailed" \? "detailed" : "summary"/.test(page), /"Season Budget Detail" : "Planned Season Budget"/.test(page)], [true, true]);
    assertEq("the choice is only in the address — nothing saved", [/window\.history\.replaceState/.test(comp), /fetch\(|localStorage|sessionStorage|supabase/.test(comp)], [true, false]);
    const css = fs.readFileSync(path.join(ROOT, "app/reports/season-budget/report.css"), "utf8");
    const pr = css.slice(css.lastIndexOf("@media print"));
    assertEq("print: category headings and column labels repeat, rows never split, short categories stay whole",
      [/\.bd-cat thead \{ display: table-header-group; \}/.test(pr), /\.bd-row \{ break-inside: avoid; \}/.test(pr), /\.bd-cat-short \{ break-inside: avoid; \}/.test(pr)], [true, true, true]);
  }

  console.log("E. the budget-line flag");
  {
    const client = fs.readFileSync(path.join(ROOT, "components/FinanceClient.js"), "utf8");
    const action = fs.readFileSync(path.join(ROOT, "lib/actions/finance.js"), "utf8");
    const query = fs.readFileSync(path.join(ROOT, "lib/queries/finance.js"), "utf8");
    assertEq("the form offers 'Parent report: Show total only' with the approved text",
      [/Parent report: Show total only/.test(client), /Transactions on this budget line won&rsquo;t be itemized on Detailed parent reports\. The\s+total will still be included\./.test(client)], [true, true]);
    assertEq("a NEW Coaches line starts ticked until the coach changes it; an existing line shows its stored flag",
      [/if \(isNew && !totalOnlyTouched\) setTotalOnly\(value === "Coaches"\)/.test(client), /useState\(Boolean\(row\?\.report_total_only\)\)/.test(client)], [true, true]);
    assertEq("the server stores exactly what the coach set, never deriving it from the category",
      [/report_total_only: formData\.get\("report_total_only"\) === "on"/.test(action), /Coaches/.test(action.slice(action.indexOf("function budgetFields"), action.indexOf("export async function saveBudgetItem")))], [true, false]);
    assertEq("the budget query reads the flag", /is_income, notes, report_total_only"/.test(query), true);
    const builder = fs.readFileSync(path.join(ROOT, "lib/queries/reports/season-budget-detail.js"), "utf8");
    assertEq("the report decides from the stored flag only, never the category name", [/line\.report_total_only/.test(builder), /"Coaches"/.test(builder)], [true, false]);
    assertEq("Finance's button reads 'Season budget report' and keeps ?from=finance", /href="\/reports\/season-budget\?from=finance">\s*Season budget report/.test(client), true);
    const mig = fs.readFileSync(path.join(ROOT, "supabase/pending/fin_report_total_only.sql"), "utf8");
    assertEq("migration: column not null default false; audited line matched on every field; exactly one updated; fingerprint guard",
      [/add column report_total_only boolean not null default false/.test(mig), /id = 'a71a5000-0000-0000-0000-000000000908'[\s\S]*category = 'Coaches' and name = 'Coach stipends'[\s\S]*budgeted = 1500\.00/.test(mig), /n_updated <> 1 or n_true <> 1/.test(mig), /rows_after <> rows_before/.test(mig)], [true, true, true, true]);
  }

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
