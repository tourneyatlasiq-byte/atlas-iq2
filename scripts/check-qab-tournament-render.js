/**
 * Tournament QAB report, RENDERED (2026-11).
 *
 * Renders the real QabTournamentReport with payloads built from the approved
 * Mower Fixture Weekend Classic numbers (production, read-only, 2026-11-17) and
 * checks what a coach reads, then checks the real stylesheet for the print and
 * phone rules that keep the document tidy.
 *
 *   A. Pack, rendered: section order, summary, comparison, record and runs,
 *      day-by-day, highest and lowest, reason mix, scores, alphabetical
 *      players, headings, no emphasis, footer
 *   B. Scope: a result game with no QAB tracking, the printed scope line
 *   C. Single-day, first tournament, no results, nothing tracked, legacy reasons
 *   D. Language: no ranking, judgment, prediction or causation words
 *   E. Stylesheet: print pagination, colour survives print, phone layout
 *
 * Browser layout (real page breaks, 390px overflow) is exercised separately by
 * scripts/verify-qab-tournament-layout.js, which needs Chrome and so is not
 * part of `npm run check`.
 *
 * Same harness as check-schedule-report.js: SWC from Next.js compiles on the
 * fly, no network or database.
 *
 * Run:  node scripts/check-qab-tournament-render.js
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
let passed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
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
const { QabTournamentReport } = require(path.join(ROOT, "components/reports/QabTournamentReport.js"));

const { PACK, NAMES } = require("./fixtures/qab-tournament-summary.js");

const render = (r) => renderToStaticMarkup(React.createElement(QabTournamentReport, { report: r }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const at = (html, s) => html.indexOf(s);
const clone = (o) => JSON.parse(JSON.stringify(o));
const withSummary = (patch) => ({ ...clone(PACK), tournamentSummary: { ...clone(PACK.tournamentSummary), ...patch } });

(function main() {
  console.log("\nTournament QAB report, rendered\n");
  const html = render(PACK);
  const body = html.slice(at(html, "<article"));
  const t = text(body);

  console.log("A. Fixture Weekend Classic");
  assertEq("sections keep the existing structure, in order: summary, QAB% by game, player totals, game by game",
    [at(body, "Tournament summary"), at(body, "QAB% by game"), at(body, "Player tournament totals"), at(body, "Game by game")].every((n, i, a) => n > 0 && (i === 0 || n > a[i - 1])), true);
  assertEq("the old Team QAB and 'What created quality at-bats' sections are replaced",
    [/Team QAB/.test(t), /What created quality at-bats/.test(t), /Season to date/i.test(t)], [false, false, false]);
  assertEq("the two player sections are not merged: separate totals table and game-by-game matrix",
    [(body.match(/class="qab-table qab-players"/g) ?? []).length, /class="qab-gbg-matrix"/.test(body), /class="qab-gbg-cards"/.test(body)], [1, true, true]);
  assertEq("hero: 54.4%, 81 QAB / 149 PA, 6 games tracked",
    [/class="qab-hero">54\.4%</.test(body), /<strong>81<\/strong> QAB \/ <strong>149<\/strong> PA/.test(body), /<strong>6<\/strong> games tracked/.test(body)], [true, true, true]);
  assertEq("current tournament beside the previous tracked tournament, counts shown, in plain rows",
    [/Fixture Weekend Classic<\/span><span class="qab-ts-cmp-val"><strong>54\.4%<\/strong> <span>\(81\/149\)<\/span>/.test(body),
     /Previous tournament, Previous Weekend Classic<\/span><span class="qab-ts-cmp-val"><strong>47\.2%<\/strong> <span>\(51\/108\)<\/span>/.test(body)], [true, true]);
  assertEq("record 4–2 and runs 47 scored / 27 allowed",
    [/Record<\/p><p class="qab-ts-fig">4–2</.test(body), /Runs scored \/ allowed/.test(body), /qab-ts-fig">47<\/p><p class="qab-ts-sub">Scored/.test(body), /qab-ts-fig">27<\/p><p class="qab-ts-sub">Allowed/.test(body)], [true, true, true, true]);
  assertEq("QAB% by day: Sat 30/65 46.2%, Sun 51/84 60.7%",
    [/Sat Nov 14<\/span><span class="n">30\/65<\/span><span class="p">46\.2%/.test(body), /Sun Nov 15<\/span><span class="n">51\/84<\/span><span class="p">60\.7%/.test(body)], [true, true]);
  assertEq("highest QAB% game: G4 vs Opponent Four, 18 / 28, 64.3%, Win 11–3",
    [/Highest QAB% game/.test(body), /<strong>G4<\/strong> vs Opponent Four/.test(body), t.includes("18 / 28 QAB / PA · Win 11–3")], [true, true, true]);
  assertEq("lowest QAB% game: G3 vs Opponent Three, 9 / 25, 36.0%, Win 5–4, stated without comment",
    [/Lowest QAB% game/.test(body), /<strong>G3<\/strong> vs Opponent Three/.test(body), t.includes("9 / 25 QAB / PA · Win 5–4"), />36\.0%</.test(body)], [true, true, true, true]);
  const legend = [...body.matchAll(/<li><span class="qab-mix-sw"[^>]*><\/span><span>([^<]+)<\/span><span class="qab-mix-n">(\d+)<\/span><span class="qab-mix-p">([\d.]+%)<\/span><\/li>/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
  assertEq("reason mix legend: exact labels, count and share on every row",
    legend, ["Hit 50 61.7%", "Walk 12 14.8%", "Situational success 8 9.9%", "Hard hit ball 5 6.2%", "HBP 2 2.5%", "Sac bunt 2 2.5%", "Sac fly 2 2.5%"]);
  assertEq("legend counts reconcile to 81 QAB; unused reasons (8+ pitch) are not listed",
    [legend.reduce((n, l) => n + Number(l.split(" ").slice(-2)[0]), 0), /8\+ pitch/.test(body)], [81, false]);
  const widths = [...body.matchAll(/class="qab-mix-seg" style="width:([\d.]+)%/g)].map((m) => Number(m[1]));
  assertEq("one stacked bar segment per reason, filling the bar",
    [widths.length, Math.abs(widths.reduce((n, w) => n + w, 0) - 100) < 0.01], [7, true]);
  assertEq("the reason bar is decoration: the legend is the reading (aria on the bar, no text in segments)",
    [/class="qab-mix-bar" role="img" aria-label="QAB reason mix"/.test(body), /<span class="qab-mix-seg"[^>]*>[^<]/.test(body)], [true, false]);
  assertEq("the one-reason explanation stays with the mix",
    t.includes("Each quality at-bat is counted once, under the one primary reason the coach recorded. Shares are of 81 quality at-bats."), true);
  const rows = [...body.matchAll(/<tr><td class="qab-c-gn">G(\d)<\/td>.*?<span class="qab-res qab-res-(\w)">(\w+)<\/span><span class="qab-score">([^<]+)<\/span>/g)].map((m) => `G${m[1]} ${m[3]} ${m[4]}`);
  assertEq("QAB% by game: the existing Win/Loss badges with the score beside each",
    rows, ["G1 Loss 4–6", "G2 Loss 5–9", "G3 Win 5–4", "G4 Win 11–3", "G5 Win 12–0", "G6 Win 10–5"]);
  assertEq("Result column keeps its word badge classes (win, loss)", [/qab-res qab-res-w"/.test(body), /qab-res qab-res-l"/.test(body)], [true, true]);
  const totalsNames = [...body.slice(at(body, "qab-players")).matchAll(/<tr><td>([^<]+)<\/td><td class="qab-num qab-c-g">/g)].map((m) => m[1]);
  assertEq("Player tournament totals: alphabetical", totalsNames, Object.keys(NAMES).sort((a, b) => a.localeCompare(b)));
  const matrixNames = [...body.slice(at(body, 'class="qab-gbg-matrix"'), at(body, 'class="qab-gbg-cards"')).matchAll(/<tr><td>([^<]+)<\/td>/g)].map((m) => m[1]);
  assertEq("Game by game: the same alphabetical order", matrixNames, totalsNames);
  assertEq("heading: 'Games with a QAB' on desktop and print, 'QAB games' on phones",
    [/<span class="qab-th-long">Games with a QAB<\/span><span class="qab-th-short">QAB games<\/span>/.test(body), /Games w\/QAB/.test(body)], [true, false]);
  assertEq("player values read '4 of 6'", [/4 of 6/.test(body), /2 of 6/.test(body)], [true, true]);
  assertEq("no cell is promoted: no QAB emphasis class anywhere, in the matrix or the phone cards",
    /qab-gbg-q/.test(body), false);
  const didNotBat = clone(PACK);
  didNotBat.players[0].byGame[2] = null;
  const dh = render(didNotBat);
  assertEq("a game the player did not bat keeps its grey dash, in the matrix and the phone card",
    [(dh.match(/qab-gbg-none/g) ?? []).length, />\u2013<\/td>/.test(dh) || /qab-gbg-none">\u2013</.test(dh)], [2, true]);
  assertEq("the dash for 'did not bat' and its explanation are kept", [/A dash means the player did not bat\./.test(body)], [true]);
  assertEq("footer keeps the definition, using the new heading",
    t.includes("Games with a QAB counts the games in which a player recorded at least one quality at-bat, out of the games in which the player batted."), true);
  assertEq("every tracked and result game: no scope line, no 'x of y'",
    [/Record and runs include/.test(t), /of \d+<\/strong> games tracked/.test(body)], [false, false]);

  console.log("B. A result game with no QAB tracking");
  const un = clone(PACK);
  un.tournamentSummary.record = { w: 4, l: 3, t: 0, played: 7 };
  un.tournamentSummary.runs = { scored: 49, allowed: 34, games: 7 };
  un.tournamentSummary.scope = { resultGames: 7, trackedGames: 6, untrackedResultGames: 1 };
  const uh = render(un), ut = text(uh);
  assertEq("hero fact reads '6 of 7 games tracked'", /<strong>6 of 7<\/strong> games tracked/.test(uh), true);
  assertEq("one printed scope line: record and runs cover 7 games, QAB figures only the 6 tracked",
    ut.includes("Record and runs include all 7 games with results. QAB figures use only the 6 games with QAB tracking."), true);
  assertEq("the scope line is plain text: not in the screen-only toolbar, no warning styling",
    [/class="qab-ts-scope"/.test(uh), /rpt-warn|rpt-no-print[^>]*>[^<]*Record and runs include/.test(uh)], [true, false]);
  assertEq("QAB figures are untouched by the extra result game", [/class="qab-hero">54\.4%</.test(uh), /\(81\/149\)/.test(uh), (uh.match(/<tr><td class="qab-c-gn">/g) ?? []).length], [true, true, 6]);
  assertEq("record and runs reflect the untracked game (4–3, 49 / 34)", [/qab-ts-fig">4–3</.test(uh), /qab-ts-fig">49</.test(uh), /qab-ts-fig">34</.test(uh)], [true, true, true]);
  const ties = clone(PACK);
  ties.tournamentSummary.record = { w: 4, l: 2, t: 1, played: 7 };
  assertEq("ties extend the record: 4–2–1", /qab-ts-fig">4–2–1</.test(render(ties)), true);
  const tracked6of8 = clone(PACK);
  tracked6of8.tournamentSummary.scope = { resultGames: 2, trackedGames: 6, untrackedResultGames: 2 };
  assertEq("result games fewer than tracked games still disclose (2 untracked): '6 of 8 games tracked'",
    /<strong>6 of 8<\/strong> games tracked/.test(render(tracked6of8)), true);

  console.log("C. Other shapes");
  const single = withSummary({ days: null });
  assertEq("single-day tournament: no day-by-day block", /QAB% by day/.test(render(single)), false);
  const first = withSummary({ previous: null });
  const fh = render(first);
  assertEq("first tournament: no comparison row at all, summary still complete",
    [/Previous tournament/.test(fh), /qab-ts-cmp/.test(fh), /class="qab-hero">54\.4%</.test(fh), /Highest QAB% game/.test(fh)], [false, false, true, true]);
  assertEq("no highest or lowest when there is nothing to name", /(Highest|Lowest) QAB% game/.test(render(withSummary({ highest: null, lowest: null }))), false);
  const noRes = withSummary({ record: null, runs: null, scope: { resultGames: 0, trackedGames: 6, untrackedResultGames: 0 } });
  noRes.games = noRes.games.map((g) => ({ ...g, result: null, runsFor: null, runsAgainst: null }));
  const nh = render(noRes);
  assertEq("no results: no Record or Runs tile, no Result column, no scores, no invented zeros",
    [/>Record</.test(nh), /Runs scored/.test(nh), /qab-c-res/.test(nh), /qab-score/.test(nh)], [false, false, false, false]);
  const resNoScore = clone(PACK);
  resNoScore.games[4].runsFor = null; resNoScore.games[4].runsAgainst = null;
  assertEq("a result with no score still shows its Win/Loss word and no score text",
    [/Opponent Five Cole\/Fowler<\/td><td class="qab-c-res"><span class="qab-res qab-res-w">Win<\/span><\/td>/.test(render(resNoScore))], [true]);
  const none = render({ ...clone(PACK), summary: { qabPct: null, qab: 0, pa: 0, games: 0 }, games: [], players: [], reasons: [], reasonsCited: 0,
    tournamentSummary: { record: null, runs: null, scope: { resultGames: 0, trackedGames: 0, untrackedResultGames: 0 }, previous: null, days: null, highest: null, lowest: null } });
  assertEq("nothing tracked: the existing empty state, no summary", [/No quality at-bats have been tracked/.test(none), /Tournament summary/.test(none)], [true, false]);
  const legacy = clone(PACK);
  legacy.reasons = [{ label: "Hit", count: 50, percent: 61.7 }, { label: "Walk", count: 12, percent: 14.8 }, { label: "Hard hit ball", count: 20, percent: 24.7 }];
  legacy.reasonsCited = 82;
  const lw = [...render(legacy).matchAll(/class="qab-mix-seg" style="width:([\d.]+)%/g)].map((m) => Number(m[1]));
  assertEq("legacy two-reason rows (counts above the QAB total): the bar still fills exactly, never overflows",
    [lw.length, Math.abs(lw.reduce((n, w) => n + w, 0) - 100) < 0.01], [3, true]);
  assertEq("no reasons: no reason mix section", /QAB reason mix/.test(render({ ...clone(PACK), reasons: [], reasonsCited: 0 })), false);
  assertEq("a long opponent name stays in the page (wraps in its cell, no fixed width)", /table-layout:\s*fixed/.test(fs.readFileSync(path.join(ROOT, "app/reports/qab-performance/qab.css"), "utf8")), false);

  console.log("D. Language");
  const banned = /\b(rank(ed|ing)?|top performer|best|worst|leader(board)?|improv(ed|ing|ement)|declin(e|ed|ing)|better|worse|trend(ing)?|predict(s|ive|ion)?|caus(e|es|ed|ing)|because|drives?|wins? (games|more)|should|needs? to|concern|weak|strong)\b/i;
  const prose = text(body.replace(/<style[\s\S]*?<\/style>/g, ""));
  assertEq("no ranking, judgment, prediction or causation words on the page", (prose.match(banned) ?? [])[0] ?? null, null);
  assertEq("no 'final score' or missing-score text is printed (check-game-score rule)", /needsFinalScore|final score|No score/i.test(fs.readFileSync(path.join(ROOT, "components/reports/QabTournamentReport.js"), "utf8")), false);

  console.log("E. Stylesheet: print and phone");
  const css = fs.readFileSync(path.join(ROOT, "app/reports/qab-performance/qab.css"), "utf8");
  const printAt = css.lastIndexOf("@media print");
  const print = css.slice(printAt);
  const phoneBlocks = [...css.matchAll(/@media screen and \(max-width: 560px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  assertEq("the summary section may split between its blocks; each block may not",
    [/\.rpt-section\.qab-tsum \{ break-inside: auto; \}/.test(css), /\.qab-ts-top, \.qab-ts-grid, \.qab-ts-scope, \.qab-ts-mix \{ break-inside: avoid; \}/.test(print)], [true, true]);
  assertEq("headings never strand at the foot of a page; rows never split; header rows repeat",
    [/\.rpt-h \{ break-after: avoid; \}/.test(print), /\.qab-table tr \{ break-inside: avoid; \}/.test(print), /\.qab-table thead \{ display: table-header-group; \}/.test(print)], [true, true, true]);
  assertEq("the Season report's print rule for its own summary is kept (Season is not modified)", /\.qab-summary \{ break-after: avoid; \}/.test(print), true);
  assertEq("the stacked bar, its segments and the legend swatches survive print (colour adjust exact)",
    [".qab-mix-bar", ".qab-mix-seg", ".qab-mix-sw"].map((sel) => new RegExp(`\\${sel}[^{]*\\{[^}]*print-color-adjust: exact`).test(css)), [true, true, true]);
  assertEq("every legend row carries label, count and share as text (readable in greyscale)",
    /grid-template-columns: 11px minmax\(0, 1fr\) 2\.4em 3\.4em/.test(css), true);
  assertEq("print does not hide Game by game or the scope control (existing rule)", /qab-gbg|qab-scope/.test(print), false);
  assertEq("the print density rows from the earlier fix are kept", [/\.qab-table td \{ padding-top: 4px; padding-bottom: 4px; \}/.test(print), /\.qab-reasons li \{ padding: 2px 0; \}/.test(print)], [true, true]);
  assertEq("phone: the Tournament page gets a narrower side padding, scoped to this report and screen only",
    [/\.rpt-page\.qab-tournament \{ padding: 28px 18px 28px; \}/.test(phoneBlocks), /rpt-page\.qab-tournament \{ padding/.test(print)], [true, false]);
  assertEq("phone: summary tiles reflow to two columns, comparison and highlights stack, the legend is one column",
    [/\.qab-ts-top \{ grid-template-columns: 1fr;/.test(phoneBlocks), /\.qab-ts-grid, \.qab-ts-grid\.two \{ grid-template-columns: 1fr 1fr;/.test(phoneBlocks), /\.qab-mix-legend \{ columns: 1; \}/.test(phoneBlocks)], [true, true, true]);
  assertEq("heading swap: long heading by default, short heading on phones",
    [/\.qab-th-short \{ display: none; \}/.test(css), /\.qab-th-long \{ display: none; \}/.test(phoneBlocks), /\.qab-th-short \{ display: inline; \}/.test(phoneBlocks)], [true, true, true]);
  assertEq("phone: the game matrix is still replaced by player cards (existing treatment kept)",
    [/\.qab-gbg-matrix \{ display: none; \}/.test(phoneBlocks), /\.qab-gbg-cards \{ display: block; \}/.test(phoneBlocks)], [true, true]);
  assertEq("no bold on a QAB cell, in the matrix or the phone tiles", /qab-gbg-q/.test(css), false);
  assertEq("the Season stylesheet and shared report.css are untouched",
    /qab-ts-|qab-mix-|qab-tsum/.test(fs.readFileSync(path.join(ROOT, "app/reports/season-budget/report.css"), "utf8")), false);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
