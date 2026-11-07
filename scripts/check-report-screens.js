/**
 * Report screens (2026-11): the shared, screen-only toolbar on every report.
 *
 *   Back | Report name | Print / Save as PDF, then only what the report needs;
 *   non-blocking notes collapsed behind "N report notes · View details";
 *   the Budget's parent note collapsed behind "+ Add a note for parents";
 *   team first, organization second in every document header; "Updated"
 *   dates; QAB number headings aligned with their numbers.
 *
 * Renders the real report components. Print behaviour (the toolbar never
 * prints) is enforced by the shared .rpt-no-print rule, checked here too.
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
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/link") return { __esModule: true, default: (p) => React.createElement("a", p, p.children) };
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
const R = (rel, name) => require(path.join(ROOT, rel))[name];
const SeasonBudgetReport = R("components/reports/SeasonBudgetReport.js", "SeasonBudgetReport");
const TournamentScheduleReport = R("components/reports/TournamentScheduleReport.js", "TournamentScheduleReport");
const QabPerformanceReport = R("components/reports/QabPerformanceReport.js", "QabPerformanceReport");
const { ParentNoteEditor } = require(path.join(ROOT, "components/reports/ReportToolbar.js"));

const ident = { generatedAt: "2026-11-06T15:00:00Z", organization: { name: "Bramblewood Fastpitch", logoUrl: null }, team: { name: "Bramblewood 14U Gold" } };
const budget = { ...ident, variant: "planned", season: { name: "2026-27" }, totalBudget: 1000,
  allocation: { total: 1000, categories: [{ category: "Tournament Fees", budgeted: 1000, percent: 100 }] },
  dues: { perPlayer: 1200 }, otherIncome: { total: 0, lines: [] }, blocked: false,
  warnings: [
    { blocking: false, title: "Individual dues arrangements", message: "This report shows the standard player dues of $1,200.00. 1 player has an individual arrangement that isn't shown." },
    { blocking: false, title: "Dues records not linked to a player", message: "2 dues records aren't linked to a player.", action: true },
  ] };
const schedule = { ...ident, scope: "season", season: { name: "2026-27" }, warnings: [], tournaments: [
  { id: "t1", name: "Dog Days Opener", startDate: "2026-08-08", endDate: "2026-08-09", status: "Committed", waitlisted: false, place: null,
    games: [{ id: "g1", date: "2026-08-08", startTime: "09:00:00", opponent: "Carolina Comets 14U", gameType: "Pool" }] }] };
const qab = { ...ident, season: { name: "2026-27" }, summary: { qabPct: 46, qab: 10, pa: 22, games: 1, players: 1 },
  games: [{ id: "g1", date: "2026-08-08", opponent: "Carolina Comets 14U", result: "W", qab: 10, pa: 22, qabPct: 45 }],
  reasons: [{ label: "Hit", count: 6, percent: 60 }], reasonsCited: 10, players: [{ name: "Avery Rowley", games: 1, qab: 10, pa: 22, qabPct: 45 }] };

const html = {
  budget: renderToStaticMarkup(React.createElement(SeasonBudgetReport, { report: budget })),
  budgetFinance: renderToStaticMarkup(React.createElement(SeasonBudgetReport, { report: budget, from: "finance" })),
  budgetNote: renderToStaticMarkup(React.createElement(SeasonBudgetReport, { report: budget, initialNote: "Bring water and a chair." })),
  schedule: renderToStaticMarkup(React.createElement(TournamentScheduleReport, { report: schedule })),
  scheduleGames: renderToStaticMarkup(React.createElement(TournamentScheduleReport, { report: schedule, initialDetail: "games" })),
  qab: renderToStaticMarkup(React.createElement(QabPerformanceReport, { report: qab })),
};
const bar = (h) => h.slice(0, h.indexOf("<article"));
const doc = (h) => h.slice(h.indexOf("<article"));

console.log("A. one toolbar pattern on every report");
for (const [key, name, title] of [["budget", "Planned Season Budget", "Planned Season Budget"], ["schedule", "Tournament Schedule", "2026-27 Tournament Schedule"], ["qab", "QAB Performance", "2026-27 QAB Performance"]]) {
  const b = bar(html[key]);
  assertEq(`${name}: Back, name and Print in the toolbar head, in that order`,
    /<div class="rpt-tb-head"><a href="[^"]+" class="rpt-tb-back">← [A-Za-z]+<\/a><p class="rpt-tb-name">([^<]+)<\/p><button[^>]*rpt-tb-print[^>]*>Print \/ Save as PDF<\/button><\/div>/.exec(b)?.[1], name);
  assertEq(`${name}: the toolbar name matches the document title`, doc(html[key]).includes(`<h1 class="rpt-doc-title">${title}</h1>`), true);
  assertEq(`${name}: no "Preview below" sub-line`, /Preview below/.test(html[key]), false);
  assertEq(`${name}: the whole toolbar is screen-only`, /^<div class="rpt-shell"><div class="rpt-bar rpt-no-print">/.test(html[key]), true);
  assertEq(`${name}: header is team first, organization second`,
    /<p class="rpt-org">Bramblewood 14U Gold<\/p><p class="rpt-team">Bramblewood Fastpitch<\/p>/.test(doc(html[key])), true);
  assertEq(`${name}: Updated, never Prepared`, [/Updated November 6, 2026/.test(doc(html[key])), /Prepared/.test(html[key])], [true, false]);
}

console.log("B. back behaviour");
const back = (h) => /class="rpt-tb-back"/.test(h) && /<a href="([^"]+)" class="rpt-tb-back">← ([A-Za-z]+)/.exec(h).slice(1);
assertEq("Budget: Reports by default", back(html.budget), ["/reports", "Reports"]);
assertEq("Budget: Finance when launched from Finance (?from=finance)", back(html.budgetFinance), ["/finance", "Finance"]);
assertEq("Schedule and QAB: Reports", [back(html.schedule), back(html.qab)], [["/reports", "Reports"], ["/reports", "Reports"]]);
assertEq("Finance's button passes from=finance", /href="\/reports\/season-budget\?from=finance"/.test(fs.readFileSync(path.join(ROOT, "components/FinanceClient.js"), "utf8")), true);

console.log("C. report notes, collapsed");
{
  const b = bar(html.budget);
  assertEq("collapsed line: \"2 report notes (1 to check) · View details\"", /aria-expanded="false"[^>]*>2 report notes \(1 to check\) · View details</.test(b), true);
  assertEq("the notes are in the page but hidden until requested", /<ul class="rpt-notes-list" hidden="">/.test(b), true);
  assertEq("every note's full title and message is preserved", budget.warnings.every((w) => b.includes(w.title) && b.includes(w.message.replace(/'/g, "&#x27;"))), true);
  assertEq("a note that asks for action keeps the stronger treatment; others are restrained",
    [(b.match(/class="rpt-note-item action"/g) ?? []).length, (b.match(/class="rpt-note-item"/g) ?? []).length], [1, 1]);
  assertEq("no large yellow warning boxes remain for non-blocking notes", /rpt-warn-note/.test(b), false);
  assertEq("no notes line when there are none (Schedule, QAB)", [/rpt-notes/.test(bar(html.schedule)), /rpt-notes/.test(bar(html.qab))], [false, false]);
  const blocked = renderToStaticMarkup(React.createElement(SeasonBudgetReport, { report: { ...budget, blocked: true, warnings: [{ blocking: true, title: "No player dues set", message: "Set dues first." }] } }));
  assertEq("blocking states are unchanged: the full-page explanation", [/rpt-blocked/.test(blocked), /No player dues set/.test(blocked), /rpt-bar/.test(blocked)], [true, true, false]);
}

console.log("D. parent note, collapsed");
{
  assertEq("collapsed by default: \"+ Add a note for parents\"", /\+ Add a note for parents/.test(bar(html.budget)), true);
  assertEq("no note field open by default", /<textarea/.test(html.budget), false);
  assertEq("once written: \"Note added · Edit\"", /Note added<\/span> · <button[^>]*>Edit<\/button>/.test(bar(html.budgetNote)), true);
  assertEq("the entered note prints in the document", doc(html.budgetNote).includes("<p class=\"rpt-note\">Bring water and a chair.</p>"), true);
  const src = fs.readFileSync(path.join(ROOT, "components/reports/ReportToolbar.js"), "utf8");
  assertEq("the open field says Not saved, with nothing persisted", [/Not saved ·/.test(src), /fetch\(|localStorage|sessionStorage|supabase/.test(src)], [true, false]);
}

console.log("E. existing controls and QAB alignment");
{
  assertEq("Schedule: the detail toggle sits in the toolbar, Tournaments only pressed",
    /<div class="rpt-bar rpt-no-print">[\s\S]*aria-pressed="true"[^>]*>Tournaments only<[\s\S]*<article/.test(html.schedule), true);
  assertEq("Schedule: Include game schedule still expands the games",
    [/vs Carolina Comets 14U/.test(doc(html.schedule)), /vs Carolina Comets 14U/.test(doc(html.scheduleGames))], [false, true]);
  const css = fs.readFileSync(path.join(ROOT, "app/reports/qab-performance/qab.css"), "utf8");
  assertEq("QAB: number headings are right-aligned like their numbers", /\.qab-table th\.qab-num \{ text-align: right; \}/.test(css), true);
  assertEq("QAB: number headings carry the number class", (html.qab.match(/<th class="qab-num[^"]*">/g) ?? []).length >= 6, true);
  const hub = fs.readFileSync(path.join(ROOT, "app/(app)/reports/page.js"), "utf8");
  assertEq("Reports hub: Performance describes the team/season report only", [/Team Quality At-Bat reporting for the season\./.test(hub), /a tournament, or one player/.test(hub)], [true, false]);
  const shared = fs.readFileSync(path.join(ROOT, "app/reports/season-budget/report.css"), "utf8");
  assertEq("collapsed notes really are hidden (the hidden attribute wins over the list's grid display)", /\.rpt-notes-list\[hidden\] \{ display: none; \}/.test(shared), true);
  assertEq("print hides every screen-only element", /\.rpt-no-print \{ display: none !important; \}/.test(shared), true);
}

console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
