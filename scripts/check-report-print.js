/* Print pagination for the long tables in the Season QAB report (2026-11).
   Found by the existing-report print check: a season with 34 tracked games printed page one as the
   team name and title only, because the games section is "avoid break inside" and is taller than a page,
   so it moved whole to page two and took the Updated line with it. Sections that hold a long table must be
   allowed to split between rows (rows themselves never split and the column headings repeat). */
const path = require("path"), fs = require("fs"), Module = require("module");
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const orig = Module._extensions[".js"];
Module._extensions[".js"] = function (m, f) { if (f.includes(`${path.sep}node_modules${path.sep}`)) return orig(m, f); m._compile(swc.transformSync(fs.readFileSync(f, "utf8"), { ...OPTS, filename: f }).code, f); };
const React = require("react");
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/link") return { __esModule: true, default: (p) => React.createElement("a", p, p.children) };
  return origLoad.call(this, request, parent, ...rest);
};
const { renderToStaticMarkup } = require("react-dom/server");
const ROOT = path.resolve(__dirname, "..");
let bad = 0; const t = (n, c) => { console.log((c ? "ok  " : "FAIL") + "  " + n); if (!c) bad++; };
const { QabPerformanceReport } = require(path.join(ROOT, "components/reports/QabPerformanceReport.js"));
const css = fs.readFileSync(path.join(ROOT, "app/reports/qab-performance/qab.css"), "utf8");
const print = css.slice(css.lastIndexOf("@media print"));

const games = Array.from({ length: 34 }, (_, i) => ({ id: "g" + i, date: "2026-08-" + String((i % 28) + 1).padStart(2, "0"), opponent: "Opp " + i, result: "W", qab: 5, pa: 15, qabPct: 33 }));
const players = Array.from({ length: 14 }, (_, i) => ({ name: "Player " + i, games: 20, qab: 10, pa: 30, qabPct: 33 }));
const report = {
  generatedAt: "2026-11-06T15:00:00Z", organization: { name: "Org", logoUrl: null }, team: { name: "Team" }, season: { name: "2026-27" },
  summary: { qabPct: 33, qab: 170, pa: 510, games: 34, players: 14 }, games, reasons: [{ label: "Hit", count: 170, percent: 100 }], reasonsCited: 170, players,
};
const html = renderToStaticMarkup(React.createElement(QabPerformanceReport, { report }));
const section = (title) => new RegExp(`<section class="([^"]*)"><p class="rpt-h">${title}</p>`).exec(html)?.[1] ?? "";

console.log("A. long tables may split between rows");
t("the QAB% by game section is marked as a long table", /\bqab-long\b/.test(section("QAB% by game")));
t("the Player QAB summary section is marked as a long table", /\bqab-long\b/.test(section("Player QAB summary")));
t("the short sections keep their no-split rule (Team QAB, reasons)", !/\bqab-long\b/.test(section("Team QAB")) && !/\bqab-long\b/.test(section("What created quality at-bats")));
t("print CSS lets a long-table section split", /\.rpt-section\.qab-long \{ break-inside: auto; \}/.test(print));
t("rows still never split and headings still repeat", /\.qab-table tr \{ break-inside: avoid; \}/.test(print) && /\.qab-table thead \{ display: table-header-group; \}/.test(print));
t("the heading is still kept with its table", /\.rpt-h \{ break-after: avoid; \}/.test(print));

console.log(bad ? `\n${bad} check(s) failed` : "\nAll report print checks passed");
process.exit(bad ? 1 : 0);
