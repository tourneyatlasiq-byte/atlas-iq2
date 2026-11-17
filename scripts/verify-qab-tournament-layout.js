/**
 * Tournament QAB report: real-browser layout verification (2026-11).
 *
 * Renders the real component with the real stylesheets and lets Chrome do what
 * a coach's browser does: print to Letter and lay the page out at 390px. Not
 * part of `npm run check` (it needs Chrome, and Chrome's output is not
 * byte-stable); run it before packaging a change to this report:
 *
 *   node scripts/verify-qab-tournament-layout.js [outputDir]
 *
 * Needs Google Chrome or Chromium (set CHROME to its path if it is not found).
 * `pdftotext` (poppler) is used for page text when present; without it the
 * page-count checks still run and the text checks are reported as skipped.
 * Writes the PDFs and phone screenshots to outputDir (default: a temp folder)
 * so they can be looked at.
 *
 *   PRINT (US Letter, default margins)
 *     - the approved 6-game, 10-player weekend prints on exactly 2 pages
 *     - page 1: header, Tournament summary, QAB% by game; page 2: the player
 *       tables, then the footer, never the footer alone
 *     - a result game with no QAB tracking, a single game and a first
 *       tournament keep the same shape
 *     - an 8-game, 12-player weekend paginates without an orphaned footer
 *   PHONE (390px)
 *     - nothing scrolls sideways, for every case above
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const Module = require("module");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0, skipped = 0;
function check(label, ok, detail = "") {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        ${detail}`}`);
}

/* ---- render the real component to static HTML ---- */
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
const { PACK } = require("./fixtures/qab-tournament-summary.js");

const css = ["app/reports/season-budget/report.css", "app/reports/qab-performance/qab.css"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---- cases ---- */
function bigger() {
  const r = clone(PACK);
  const extra = [[7, "Sat Nov 21", "09:00:00", "Opponent Seven", "W", 9, 2, 14, 24], [8, "Sun Nov 22", "10:30:00", "Opponent Eight", "L", 3, 7, 8, 22]];
  for (const [number, day, time, opponent, result, runsFor, runsAgainst, qab, pa] of extra)
    r.games.push({ id: `g${number}`, number, day, time, opponent, result, runsFor, runsAgainst, qab, pa, qabPct: Math.round((qab / pa) * 1000) / 10 });
  for (const p of r.players) p.byGame.push({ qab: 1, pa: 2 }, { qab: 1, pa: 2 });
  for (const n of ["Kestrel Owen", "Linden Marsh"]) r.players.push({ name: n, games: 8, qab: 7, pa: 16, qabPct: 43.8, qabGames: 5, byGame: Array.from({ length: 8 }, () => ({ qab: 1, pa: 2 })) });
  r.players.sort((a, b) => a.name.localeCompare(b.name));
  r.summary = { qabPct: 53.3, qab: 103, pa: 195, games: 8 };
  r.tournamentSummary.record = { w: 5, l: 3, t: 0, played: 8 };
  r.tournamentSummary.runs = { scored: 59, allowed: 36, games: 8 };
  r.tournamentSummary.scope = { resultGames: 8, trackedGames: 8, untrackedResultGames: 0 };
  r.tournamentSummary.days = [
    { date: "2026-11-14", label: "Sat Nov 14", qab: 30, pa: 65, qabPct: 46.2, games: 3 }, { date: "2026-11-15", label: "Sun Nov 15", qab: 51, pa: 84, qabPct: 60.7, games: 3 },
    { date: "2026-11-21", label: "Sat Nov 21", qab: 14, pa: 24, qabPct: 58.3, games: 1 }, { date: "2026-11-22", label: "Sun Nov 22", qab: 8, pa: 22, qabPct: 36.4, games: 1 },
  ];
  return r;
}
function untracked() {
  const r = clone(PACK);
  r.tournamentSummary.record = { w: 4, l: 3, t: 0, played: 7 };
  r.tournamentSummary.runs = { scored: 49, allowed: 34, games: 7 };
  r.tournamentSummary.scope = { resultGames: 7, trackedGames: 6, untrackedResultGames: 1 };
  return r;
}
function oneGame() {
  const r = clone(PACK);
  r.games = [r.games[3]];
  r.players = r.players.map((p) => ({ ...p, games: 1, qab: p.byGame[3].qab, pa: p.byGame[3].pa, qabPct: Math.round((p.byGame[3].qab / p.byGame[3].pa) * 1000) / 10, qabGames: p.byGame[3].qab > 0 ? 1 : 0, byGame: [p.byGame[3]] }));
  r.summary = { qabPct: 64.3, qab: 18, pa: 28, games: 1 };
  r.tournamentSummary = { ...r.tournamentSummary, record: { w: 1, l: 0, t: 0, played: 1 }, runs: { scored: 11, allowed: 3, games: 1 }, days: null, highest: null, lowest: null, previous: null, scope: { resultGames: 1, trackedGames: 1, untrackedResultGames: 0 } };
  r.reasons = [{ label: "Hit", count: 18, percent: 100 }]; r.reasonsCited = 18;
  return r;
}
function longNames() {
  const r = untracked();
  r.tournament = { ...(r.tournament ?? {}), name: "The Annual Peach State Memorial Day Championship Series, Presented by Local Sponsors" };
  r.tournamentSummary.previous = { name: "Georgia Elite Regional Qualifier and Invitational Classic Weekend, Southeast Division", qab: 51, pa: 108, qabPct: 47.2 };
  return r;
}
const first = () => { const r = clone(PACK); r.tournamentSummary.previous = null; return r; };
const CASES = [
  { key: "pack", title: "approved 6-game, 10-player weekend", report: PACK, pages: 2, strict: true },
  { key: "untracked", title: "result game with no QAB tracking", report: untracked(), pages: 2, strict: true },
  { key: "long", title: "very long tournament names", report: longNames(), pages: 2, strict: true },
  { key: "first", title: "first tournament (no previous)", report: first(), pages: 2, strict: true },
  { key: "one-game", title: "a single game", report: oneGame(), maxPages: 2 },
  { key: "big", title: "8-game, 12-player weekend over four days", report: bigger(), maxPages: 3 },
];

/* ---- Chrome ---- */
function findChrome() {
  const c = [process.env.CHROME, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean);
  for (const x of c) { const r = spawnSync(x, ["--version"], { encoding: "utf8" }); if (!r.error && r.status === 0) return x; }
  return null;
}
const chrome = findChrome();
if (!chrome) { console.log("\nNo Chrome or Chromium found (set CHROME). Layout verification skipped."); process.exit(0); }
const out = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), "qab-layout-"));
fs.mkdirSync(out, { recursive: true });
const hasText = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).error == null;
const baseArgs = ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"];
const pageText = (pdf, n) => spawnSync("pdftotext", ["-f", String(n), "-l", String(n), "-layout", pdf, "-"], { encoding: "utf8" }).stdout.replace(/\s+/g, " ").trim().toLowerCase();
const FOOT = "a quality at-bat is recorded by the coach";

console.log(`\nTournament QAB layout (Chrome: ${chrome})\nOutput: ${out}\n`);
for (const c of CASES) {
  console.log(`${c.title}`);
  const body = renderToStaticMarkup(React.createElement(QabTournamentReport, { report: c.report }));
  const probe = `<script>window.addEventListener("load",function(){document.documentElement.setAttribute("data-sw",document.documentElement.scrollWidth);document.documentElement.setAttribute("data-iw",window.innerWidth);});</script>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--font-inter:Inter,"Liberation Sans",Arial,sans-serif}body{margin:0}${css}</style></head><body>${body}${probe}</body></html>`;
  const file = path.join(out, `${c.key}.html`);
  fs.writeFileSync(file, html);
  const url = "file://" + file.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:");

  // Print: US Letter, no browser header or footer.
  const pdf = path.join(out, `${c.key}.pdf`);
  spawnSync(chrome, [...baseArgs, "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, url], { encoding: "utf8" });
  const bytes = fs.existsSync(pdf) ? fs.readFileSync(pdf).toString("latin1") : "";
  const pages = (bytes.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (c.pages) check(`prints on exactly ${c.pages} Letter page${c.pages === 1 ? "" : "s"}`, pages === c.pages, `got ${pages}`);
  if (c.maxPages) check(`prints on at most ${c.maxPages} pages`, pages >= 1 && pages <= c.maxPages, `got ${pages}`);
  if (hasText && pages >= 1) {
    const last = pageText(pdf, pages);
    check("the last page is more than the footer alone", last.length > FOOT.length + 400, `last page: ${last.slice(0, 160)}`);
    check("the footer prints, with Game by game on the same page", last.includes(FOOT) && last.includes("game by game"), "footer or Game by game missing from the last page");
    if (c.strict) {
      const p1 = pageText(pdf, 1), p2 = pageText(pdf, 2);
      check("page 1 holds the header, Tournament summary and QAB% by game", ["tournament summary", "qab% by game", "qab reason mix"].every((t) => p1.includes(t)), p1.slice(0, 200));
      const untrackedCase = c.report.tournamentSummary.scope.untrackedResultGames > 0;
      check(untrackedCase ? "the scope line prints on page 1 (record and runs vs QAB tracking)" : "no scope line when every result game is tracked",
        p1.includes("record and runs include all") === untrackedCase, p1.slice(0, 300));
      check("page 2 begins with Player tournament totals", p2.startsWith("player tournament totals"), p2.slice(0, 120));
    }
  } else if (!hasText) skipped++;

  spawnSync(chrome, [...baseArgs, "--window-size=1120,1500", `--screenshot=${path.join(out, `${c.key}-desktop.png`)}`, url], { encoding: "utf8" });

  // Phone: headless Chrome will not open a window narrower than 500px, so the
  // page is laid out inside a 390px iframe (its own viewport, so the phone
  // media queries apply) and the iframe's scroll width is read back.
  const esc = html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const wrap = `<!doctype html><html><body style="margin:0;background:#e5e7eb"><iframe id="f" width="390" height="6000" style="border:0;display:block;background:#fff" srcdoc="${esc}"></iframe>` +
    `<script>window.addEventListener("load",function(){setTimeout(function(){var d=document.getElementById("f").contentDocument;var r=d.documentElement;document.documentElement.setAttribute("data-sw",r.scrollWidth);document.documentElement.setAttribute("data-iw",d.defaultView.innerWidth);document.documentElement.setAttribute("data-h",r.scrollHeight);},300);});</script></body></html>`;
  const wfile = path.join(out, `${c.key}-390.html`);
  fs.writeFileSync(wfile, wrap);
  const wurl = "file://" + wfile.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:");
  const dom = spawnSync(chrome, [...baseArgs, "--window-size=500,900", "--virtual-time-budget=3000", "--dump-dom", wurl], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";
  const sw = Number((dom.match(/data-sw="(\d+)"/) ?? [])[1]), iw = Number((dom.match(/data-iw="(\d+)"/) ?? [])[1]);
  check(`390px: no sideways scroll (content ${sw}px in a ${iw}px viewport)`, iw === 390 && Number.isFinite(sw) && sw <= iw, "the page is wider than the phone");
  spawnSync(chrome, [...baseArgs, "--window-size=500,4200", `--screenshot=${path.join(out, `${c.key}-390.png`)}`, wurl], { encoding: "utf8" });
}
console.log(`\n${passed + failed} checks, ${failed} failed${skipped ? `, page text checks skipped for ${skipped} case(s) (pdftotext not found)` : ""}`);
process.exit(failed ? 1 : 0);
