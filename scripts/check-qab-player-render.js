/**
 * Individual player QAB report, RENDERED (RPT-002, 2026-11).
 * Renders the real component with payloads built by the real rules, then reads
 * the stylesheet for the print and colour rules. Browser layout (real page
 * breaks, 390px) is exercised separately and needs Chrome.
 *
 * Run:  node scripts/check-qab-player-render.js
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
function ok(label, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) passed++; else failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${pass ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/link") return { __esModule: true, default: (p) => require("react").createElement("a", p, p.children) };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { QabPlayerReport } = require(path.join(ROOT, "components/reports/QabPlayerReport.js"));
const { buildQabPlayerReport } = require(path.join(ROOT, "lib/qab-player-rules.js"));
const { qabPercent } = require(path.join(ROOT, "lib/qab-rules.js"));

const slot = (playerId, name, qab, pa) => ({ playerId, name, qab, pa });
const G = (id, date, tid, tn, opp, lineup) => ({ gameId: id, gameDate: date, startTime: null, tournamentId: tid, tournament: tn, opponent: opp, result: "L", runsFor: 1, runsAgainst: 7, lineup });
const games = [
  G("g1", "2026-11-07", "t1", "Show Me Classic", "Rays", [slot("a", "Ava Lane", 2, 3), slot("d", "Dee Teammate", 1, 3)]),
  G("g2", "2026-11-08", "t1", "Show Me Classic", "Stars", [slot("a", "Ava Lane", 1, 4)]),
  G("g4", "2026-11-14", "t2", "Bash at the Lake", "Owls", [slot("a", "Ava Lane", 3, 3)]),
];
const hist = games.flatMap((g) => g.lineup.filter((s) => s.playerId === "a").map((s) => ({ ...s, opponent: g.opponent, gameDate: g.gameDate, gameId: g.gameId })));
const scoped = { games, players: [{ playerId: "a", name: "Ava \"Ace\" O'Lane", qab: 6, pa: 10, qabPct: qabPercent(6, 10), history: hist, reasons: [{ label: "Hard-hit ball", count: 4 }, { label: "Walk", count: 2 }] }] };
const ident = { organization: { name: "Mower Fixtures", logoUrl: null }, team: { name: "16U" }, season: { name: "2026-27" } };
const mk = (extra = {}, sc = scoped, pid = "a") => buildQabPlayerReport({ scoped: sc, playerId: pid, name: "Ava \"Ace\" O'Lane", identity: ident, generatedAt: "2026-11-20T12:00:00Z", ...extra });
const render = (r) => renderToStaticMarkup(React.createElement(QabPlayerReport, { report: r }));
const text = (h) => h.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&middot;/g, "·").replace(/\s+/g, " ").trim();

console.log("\nIndividual player QAB report, rendered\n");
const html = render(mk());
const doc = html.slice(html.indexOf("<article"));
const t = text(doc);

console.log("A. Season report");
ok("headline: 60.0% QAB rate, 6 / 10 QAB / PA, 3 games with a PA", [/>60\.0%</.test(doc), t.includes("6 / 10"), /<b>3<\/b><span>Games with a PA/.test(doc)], [true, true, true]);
ok("sections in order: summary, how QABs were earned, game by game", ["Quality at-bat rate", "How QABs were earned", "Game by game"].map((s) => doc.indexOf(s)).every((n, i, a) => n > 0 && (i === 0 || n > a[i - 1])), true);
ok("reason lines show count and share of QAB, one decimal", [t.includes("Hard-hit ball 4 · 66.7%"), t.includes("Walk 2 · 33.3%")], [true, true]);
ok("coverage line exact; the repeated bottom disclaimer is gone; the one-reason explanation appears once", [t.includes("Recorded plate appearances only; untracked games are excluded."), t.includes("each QAB is counted under one primary reason."), (t.match(/one primary reason/g) || []).length, /class="qp-foot"/.test(html)], [true, false, 1, false]);
ok("tournament headings in order, then every game as a list row and a table row", [t.indexOf("Show Me Classic") < t.indexOf("Bash at the Lake"), (doc.match(/class="qp-gl"/g) ?? []).length, (doc.match(/class="qp-tbl"/g) ?? []).length], [true, 2, 2]);
ok("the heading row of each table is in thead (it repeats on a continuation page)", (doc.match(/<thead><tr class="qp-g">/g) ?? []).length, 2);
ok("no teammate, no score, no result, no comparison", [/Dee Teammate/.test(html), /\b(Win|Loss|Tie)\b/.test(t), /1-7|1 - 7|vs team|team average/i.test(t)], [false, false, false]);
ok("the apostrophe and quotes in a name survive as text and cannot break the print header rule", [t.includes("Ava \"Ace\" O'Lane"), /@page qabplayer\{@top-left\{content:"Ava \\&quot;Ace\\&quot; O&#x27;Lane/.test(html) || /content:"Ava [^"]*\\"Ace\\"/.test(html.replace(/&quot;/g, '"'))], [true, true]);
ok("print help names the Headers and footers checkbox, exact, on screen only (inside the toolbar, which never prints)", [html.includes("set Margins to Default and untick Headers and footers (under More settings). Chrome otherwise adds its own date and page title to every page."), /rpt-no-print[\s\S]*qp-help/.test(html)], [true, true]);
ok("print tip is collapsed by default behind a Before you print summary, still in the toolbar", [/<details class="qp-tips"><summary>Before you print: turn off Headers and footers<\/summary>/.test(html), /<details class="qp-tips" open/.test(html)], [true, false]);
ok("QAB reads as rate and counts only: no ranking words", /best|worst|top|rank|improv|declin|trend|clutch|hot|cold/i.test(t), false);

console.log("B. Status tags, empty and zero");
ok("pickup tag beside the team line", text(render(mk({ status: "pickup" })).slice(0)).includes("16U Pickup player"), true);
ok("inactive tag", text(render(mk({ status: "inactive" }))).includes("16U Inactive"), true);
ok("no tag for an active player", /qp-tag/.test(html), false);
const empty = render(mk({}, { games: [], players: [] }, "zzz"));
ok("empty history: a plain sentence, no 0 / 0 summary, no tables", [text(empty).includes("has no recorded plate appearances this season"), /qp-pct|qp-tbl/.test(empty)], [true, false]);
const emptyT = render(mk({ tournament: { id: "t9", name: "Bash at the Lake", start_date: "2026-11-14", end_date: "2026-11-15" } }, { games: [], players: [] }, "zzz"));
ok("empty in a tournament names the tournament", text(emptyT).includes("no recorded plate appearances in Bash at the Lake"), true);
const zeroHist = hist.map((h) => ({ ...h, qab: 0 }));
const zero = render(mk({}, { games, players: [{ playerId: "a", name: "Ava", qab: 0, pa: 10, qabPct: 0, history: zeroHist, reasons: [] }] }));
ok("zero QAB: 0.0% and a plain line instead of empty bars", [/>0\.0%</.test(zero), text(zero).includes("No quality at-bats recorded in this scope.")], [true, true]);

console.log("C. Tournament scope and the note");
const TS = { id: "t2", name: "Bash at the Lake", start_date: "2026-11-10", end_date: "2026-11-12" };
const tr = render(mk({ tournament: TS }, { games: games.filter((g) => g.tournamentId === "t2"), players: [{ playerId: "a", name: "Ava", qab: 3, pa: 3, qabPct: 100, history: hist.filter((h) => h.gameId === "g4"), reasons: [{ label: "Walk", count: 3 }] }] }));
ok("scope line carries the tournament and dates; one heading table", [text(tr).includes("QAB Player Report · Bash at the Lake · Nov 10"), (tr.match(/class="qp-tbl"/g) ?? []).length], [true, 1]);
ok("the outside-dates note renders inside the toolbar with a Review game link", [/Game date to review/.test(tr), /href="\/tournaments\/t2\/games\/g4\/track\?from=player-report&amp;player=a&amp;scope=t2"/.test(tr)], [true, true]);

{
  const printed = tr.slice(tr.indexOf("<article"));
  ok("the explanation is in the printed document, not only the toolbar: row marker, list marker and a sentence", [/\(outside tournament dates\)/.test(printed), /outside tournament dates<\/span>/.test(printed), text(printed).includes("A game marked outside tournament dates is linked to this tournament but dated outside its dates. It is included because of that link.")], [true, true, true]);
  ok("no marker and no sentence when every game is inside the dates", /outside tournament dates/.test(render(mk({ tournament: { id: "t1", name: "Show Me Classic", start_date: "2026-11-07", end_date: "2026-11-08" } }, { games: games.filter((g) => g.tournamentId === "t1"), players: [{ playerId: "a", name: "Ava", qab: 3, pa: 7, qabPct: 42.9, history: hist.filter((h) => h.gameId !== "g4"), reasons: [{ label: "Walk", count: 3 }] }] }))), false);
}

console.log("D. Stylesheet");
const css = fs.readFileSync(path.join(ROOT, "app/reports/qab-player/player.css"), "utf8");
ok("named page with margin boxes for the running header and Page X of Y, first page without a header", [/@page qabplayer\s*\{/.test(css), /counter\(page\) " of " counter\(pages\)/.test(css), /@page qabplayer:first \{ @top-left \{ content: none/.test(css)], [true, true, true]);
ok("the table heading row repeats; short tournaments stay together", [/thead \{ display: table-header-group/.test(css), /break-inside: avoid/.test(css)], [true, true]);
ok("no Volt lime anywhere in the document stylesheet", /d2ff3d|c3f52a/i.test(css), false);
ok("phone shows the list, print and desktop show the table", [/\.qp-tbl \{ display: none/.test(css), /@media \(min-width: 700px\)[\s\S]*\.qp-lists \{ display: none/.test(css), /@media print[\s\S]*\.qp-lists \{ display: none !important/.test(css)], [true, true, true]);
ok("print help states Default tested; the CSS records None/Minimum as NOT VERIFIED", /NOT VERIFIED: Margins None or Minimum/.test(css), true);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
