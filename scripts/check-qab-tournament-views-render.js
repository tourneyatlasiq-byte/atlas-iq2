/**
 * Season by tournament and Games with a QAB, RENDERED (2026-11).
 * Real components, payloads from the real rules. Browser layout at 375/390px and
 * the print PDFs are exercised separately (they need Chrome).
 *
 * Run:  node scripts/check-qab-tournament-views-render.js
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
const V = require(path.join(ROOT, "components/QabTournamentViews.js"));
const { QabPlayerReport } = require(path.join(ROOT, "components/reports/QabPlayerReport.js"));
const { QabPerformanceReport } = require(path.join(ROOT, "components/reports/QabPerformanceReport.js"));
const { buildQabPlayerReport } = require(path.join(ROOT, "lib/qab-player-rules.js"));
const R = require(path.join(ROOT, "lib/qab-tournament-rows.js"));
const css = fs.readFileSync(path.join(ROOT, "app/qab-tournaments.css"), "utf8");
const text = (h) => h.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&middot;/g, "·").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const LONG = "The Very Long Named Midwest Summer Classic Championship Series Presented By Local Sponsors";
const g = (gameId, gameDate, startTime, tournamentId, tournament, opponent, qab, pa, completed = true) =>
  ({ gameId, gameDate, startTime, tournamentId, tournament, opponent, qab, pa, completed });
const games = [
  g("g1", "2026-11-06", null, "tA", "T25 (Scenic)", "Corona Angels", 18, 32),
  g("g2", "2026-11-06", null, "tA", "T25 (Scenic)", "Athletics Mercado", 18, 29),
  g("g3", "2026-11-13", "16:00:00", "tB", LONG, "Texas Blaze", 9, 25),
  g("g4", "2026-11-21", "11:30:00", "tC", "Show Me The Money", "Top Gun Sciara", 12, 23),
  g("g5", "2026-11-21", "16:45:00", "tC", "Show Me The Money", "Team Long Island", 15, 25, false),
];
const rows = R.tournamentRows(games);

console.log("\nSeason by tournament, rendered\n");
console.log("A. Bars");
const bars = renderToStaticMarkup(React.createElement(V.TournamentBars, { rows, seasonPct: 50 }));
const bt = text(bars);
ok("every row shows QAB / PA beside a one-decimal percentage", [bt.includes("36 QAB / 61 PA"), bt.includes("59.0%"), bt.includes("9 QAB / 25 PA"), bt.includes("36.0%")], [true, true, true, true]);
ok("Tracking in progress appears once, on the tournament with an unfinished game", (bt.match(/Tracking in progress/g) || []).length, 1);
ok("no wording that calls a tournament complete or in progress by date", /\bIn progress\b|\bComplete\b/.test(bt), false);
ok("stripe only on the bar that includes an unfinished game", (bars.match(/qtv-fill--prov/g) || []).length, 1);
ok("the season tick is explained once, the provisional note once", [(bt.match(/Season QAB%: 50\.0%/g) || []).length, (bt.match(/may change/g) || []).length], [1, 1]);
ok("long tournament name is present in full and its row can wrap", [bt.includes(LONG), /\.qtv-name\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css)], [true, true]);
ok("no em or en dash anywhere in the rendered text", /[–—]/.test(bt), false);
const noUnfinished = renderToStaticMarkup(React.createElement(V.TournamentBars, { rows: R.tournamentRows(games.map((x) => ({ ...x, completed: true }))), seasonPct: 50 }));
ok("all games finished: no stripe, no provisional note, no status", [/qtv-fill--prov/.test(noUnfinished), /may change|Tracking in progress/.test(text(noUnfinished))], [false, false]);

console.log("B. Player card");
const hist = [["g1", 2, 2], ["g3", 1, 2], ["g5", 1, 2]].map(([gameId, qab, pa]) => ({ gameId, qab, pa }));
const view = R.playerTournamentView(games, hist);
const card = renderToStaticMarkup(React.createElement(V.PlayerTournamentCard, { view, seasonPct: 50 }));
const ct = text(card);
ok("text count beside the dots", ct.includes("QAB in 3 of 3 games with a PA."), true);
ok("a tournament where she did not bat shows No PA, no percentage and no bar", (() => { const h = renderToStaticMarkup(React.createElement(V.PlayerTournamentCard, { view: R.playerTournamentView(games, hist.slice(0, 1)), seasonPct: 50 })); const row = h.slice(h.indexOf("Show Me The Money"), h.indexOf("</li>", h.indexOf("Show Me The Money"))); return [row.includes("No PA"), /%/.test(text(row)), /qtv-bar/.test(row)]; })(), [true, false, false]);
ok("her bar is striped only where her figures include the unfinished game", (card.match(/qtv-fill--prov/g) || []).length, 1);
ok("every dot is a button with a date and opponent label", [(card.match(/<button/g) || []).length, (card.match(/aria-label="Nov \d+, vs [^"]+"/g) || []).length], [5, 5]);
ok("dot states are distinguishable by shape classes", [/qtv-dot--qab/.test(card), /qtv-dot--nopa/.test(card), /qtv-dot--open/.test(card)], [true, true, true]);
ok("legend lists the dot states once", (() => { const lg = text(card.slice(card.indexOf("qtv-legend"), card.indexOf("</ul>", card.indexOf("qtv-legend")))); return [(lg.match(/QAB recorded/g) || []).length, (lg.match(/Batted, no QAB/g) || []).length, (lg.match(/No PA recorded/g) || []).length]; })(), [1, 1, 1]);
ok("same-day order note appears when a day has no start times", ct.includes("listed by opponent, not in play order"), true);
const zero = renderToStaticMarkup(React.createElement(V.PlayerTournamentCard, { view: R.playerTournamentView(games, []), seasonPct: 50 }));
ok("zero PA: no percentage, no bar, no stripe, clear text", [/qtv-bar/.test(zero), /qtv-fill/.test(zero), text(zero).includes("No plate appearances recorded yet.")], [false, false, true]);
ok("player rows say '1 game with a PA' or 'No PA recorded', never 'x of y games'", (() => { const rowText = text(renderToStaticMarkup(React.createElement(V.TournamentBars, { rows: R.playerTournamentView(games, hist.slice(0, 1)).rows, seasonPct: 50, player: true }))); return [rowText.includes("1 game with a PA"), rowText.includes("No PA recorded"), /\d+ of \d+ games? with a PA/.test(rowText)]; })(), [true, true, false]);
ok("printed key lists no-PA games by date and opponent, once, with a screen-hidden class", (() => { const h = renderToStaticMarkup(React.createElement(V.PlayerTournamentCard, { view: R.playerTournamentView(games, hist.slice(0, 1)), seasonPct: 50 })); const k = h.slice(h.indexOf("qtv-print-nopa")); return [(h.match(/qtv-print-nopa"/g) || []).length, text(k).includes("Nov 13, vs Texas Blaze"), text(k).includes("Nov 21, vs Team Long Island")]; })(), [1, true, true]);
ok("no key when she batted in every game", (() => { const all = games.map((x) => ({ gameId: x.gameId, qab: 1, pa: 2 })); return /qtv-print-nopa/.test(renderToStaticMarkup(React.createElement(V.PlayerTournamentCard, { view: R.playerTournamentView(games, all), seasonPct: 50 }))); })(), false);
ok("a single-tournament player: bars hidden, dots kept", (() => { const one = R.playerTournamentView(games.slice(0, 2), hist.slice(0, 1)); const h = renderToStaticMarkup(React.createElement(V.PlayerTournamentCard, { view: one, seasonPct: 50 })); return [/qtv-rows/.test(h), /qtv-dot/.test(h)]; })(), [false, true]);

console.log("C. Reports");
const ident = { organization: { name: "Armor Elite", logoUrl: null }, team: { name: "28/29 Lynch" }, season: { name: "2026-27" } };
const scoped = { games, players: [{ playerId: "a", name: "Ava", qab: 4, pa: 6, qabPct: 66.7, history: hist, reasons: [{ label: "Walk", count: 4 }] }] };
const preport = buildQabPlayerReport({ scoped, playerId: "a", name: "Ava", identity: ident, generatedAt: "2026-11-21T12:00:00Z" });
const phtml = renderToStaticMarkup(React.createElement(QabPlayerReport, { report: preport }));
const pdoc = phtml.slice(phtml.indexOf("<article"));
ok("player report keeps all existing sections and inserts the new ones after Summary", ["Quality at-bat rate", "QAB% by tournament", "Games with a QAB", "How QABs were earned", "Game by game"].map((s) => pdoc.indexOf(s)).every((n, i, a) => n > 0 && (i === 0 || n > a[i - 1])), true);
const ptournament = buildQabPlayerReport({ scoped, playerId: "a", name: "Ava", identity: ident, tournament: { id: "tA", name: "T25 (Scenic)", start_date: "2026-11-06", end_date: "2026-11-08" } });
ok("tournament scope: no new sections and no payload field", [ptournament.tournaments, /Games with a QAB/.test(renderToStaticMarkup(React.createElement(QabPlayerReport, { report: ptournament })))], [null, false]);
ok("player payload tournaments carry no tournament id or teammate data", /"tournamentId"|"playerId"|tA|tB|tC/.test(JSON.stringify(preport.tournaments)), false);

const season = {
  generatedAt: "2026-11-21T12:00:00Z", ...ident,
  summary: { qabPct: 50, qab: 72, pa: 134, games: 5, players: 12 },
  games: games.map((x) => ({ id: x.gameId, date: x.gameDate, opponent: x.opponent, result: null, qab: x.qab, pa: x.pa, qabPct: R.tournamentRows([x])[0].qabPct })),
  reasons: [{ label: "Walk", count: 10, percent: 13.9 }], reasonsCited: 10,
  players: [{ name: "Ava", games: 3, qab: 4, pa: 6, qabPct: 66.7 }],
  tournaments: rows.map((r) => ({ name: r.name, games: r.games, qab: r.qab, pa: r.pa, qabPct: r.qabPct, firstDate: r.firstDate, lastDate: r.lastDate, trackingInProgress: r.trackingInProgress, includesUnfinished: r.includesUnfinished })),
};
const shtml = renderToStaticMarkup(React.createElement(QabPerformanceReport, { report: season }));
const sdoc = shtml.slice(shtml.indexOf("<article") > 0 ? shtml.indexOf("<article") : 0);
ok("season report: Season by tournament sits before QAB% by game, existing sections intact", ["Season by tournament", "QAB% by game", "What created quality at-bats", "Player QAB summary"].map((s) => sdoc.indexOf(s)).every((n, i, a) => n > 0 && (i === 0 || n > a[i - 1])), true);
const sNo = renderToStaticMarkup(React.createElement(QabPerformanceReport, { report: { ...season, tournaments: undefined } }));
ok("tournament scope or older payload: section absent, report still renders", [/Season by tournament/.test(sNo), /QAB% by game/.test(sNo)], [false, true]);
const sOne = renderToStaticMarkup(React.createElement(QabPerformanceReport, { report: { ...season, tournaments: season.tournaments.slice(0, 1) } }));
ok("one tournament: no redundant breakdown", /Season by tournament/.test(sOne), false);

console.log("D. Stylesheet");
ok("print: bars and stripes keep their colours, readout hidden, rows do not split", [/@media print[\s\S]*\.qtv-readout\s*\{\s*display:\s*none/.test(css), /print-color-adjust:\s*exact/.test(css), /\.qtv-row\s*\{[^}]*break-inside:\s*avoid/.test(css)], [true, true, true]);
ok("no font family is set here: screens' own fonts are inherited, figures use the app's display font variable", [/font-family\s*:\s*(?!var)/.test(css), /var\(--font-schibsted\)/.test(css)], [false, true]);
ok("ink on white: no colour values beyond the grays", /#(?!0c0f14|262b34|626b79|e4e7ec|d3d8df|eef0f3|fff\b)[0-9a-f]{3,6}\b/i.test(css), false);
ok("figures use normal numerals so the decimal point is not widened", /\.qtv-pct\s*\{[^}]*font-variant-numeric:\s*normal/.test(css), true);
ok("the player card labels its tick as the player's own season rate", text(card).includes("Player season QAB%: 50.0%"), true);
ok("print keeps each new section, with its key and notes, on one page", /@media print[\s\S]*\.qtv\s*\{\s*break-inside:\s*avoid/.test(css), true);
ok("tap targets are at least 44px while the visible dots stay small", [/\.qtv-dot\s*\{[^}]*width:\s*44px;\s*height:\s*44px/.test(css), /\.qtv-dot--qab \.qtv-dot-mark[^{]*\{[^}]*width:\s*14px;\s*height:\s*14px/.test(css)], [true, true]);
ok("dots and days wrap so a phone never scrolls sideways", [/\.qtv-dots\s*\{[^}]*flex-wrap:\s*wrap/.test(css), /\.qtv-days\s*\{[^}]*flex-wrap:\s*wrap/.test(css)], [true, true]);
ok("the printed no-PA key is hidden on screen and shown in print", [/\.qtv-print-nopa\s*\{\s*display:\s*none/.test(css), /@media print[\s\S]*\.qtv-print-nopa\s*\{\s*display:\s*block/.test(css)], [true, true]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
