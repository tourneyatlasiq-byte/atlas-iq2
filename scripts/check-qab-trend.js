/**
 * QAB% by game on Performance (2026-11): the zoomed trend line.
 *
 * Runs the real chart arithmetic (lib/qab-trend.js) and renders the real
 * component (QabTrend in components/PerformanceSeason.js) for the four
 * approved cases:
 *
 *   northgate   short season; its last two games are genuinely still tracking
 *   mower       the real Mower season (11 games, all complete)
 *   inProgress  one open game after finished ones
 *   long        24 games: the long-season regression case
 *
 *   A. Scale: zoomed to the season's range, whole tens, stated in words,
 *      never 0 to 100 for a normal season, the season line always inside it
 *   B. Segments: solid only between two finished games; anything touching an
 *      in-progress game is dotted
 *   C. Rendering: tournament bands, labelled gridlines, season line, W/L/T lane
 *      only where recorded, provisional point + asterisk + "In progress, can
 *      still change" in the readout, the slider's spoken value
 *   D. One behaviour for every length: the 3-game and 24-game charts use the
 *      same elements
 *   E. Stylesheet: compact desktop readout, larger phone readout, slider focus
 *      ring, touch scrubbing that leaves vertical scroll alone
 *   F. Nothing else on Performance moved: the rest of the component and of the
 *      stylesheet are identical to the base revision
 *
 * Same harness as check-qab-tournament-render.js (SWC compiles on the fly; no
 * network, no database, no browser). The real-browser behaviour (hover, touch,
 * keyboard, 390px fit) is verified by scripts/verify-qab-trend-browser.py.
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
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
const T = require(path.join(ROOT, "lib/qab-trend.js"));
const { QabTrend } = require(path.join(ROOT, "components/PerformanceSeason.js"));
const FIX = require("./fixtures/qab-trend-games.js");

const season = (games) => Math.round((games.reduce((n, g) => n + g.qab, 0) / games.reduce((n, g) => n + g.pa, 0)) * 1000) / 10;
const html = (games) => renderToStaticMarkup(React.createElement(QabTrend, { games, seasonPct: season(games) }));
const count = (h, re) => (h.match(re) ?? []).length;
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/* ---------------- A. scale ---------------- */
console.log("\nA. The scale");
{
  const sc = (k) => { const g = FIX[k]; return T.trendScale(T.trendPoints(g).map((x) => x.qabPct), season(g)); };
  assertEq("Northgate (48.0 to 64.3%, season 58.2): scale 40 to 70", sc("northgate"), { lo: 40, hi: 70, ticks: [40, 50, 60, 70] });
  assertEq("Mower (36.0 to 64.3%, season 51.4): scale 30 to 70", sc("mower"), { lo: 30, hi: 70, ticks: [30, 40, 50, 60, 70] });
  const lg = sc("long");
  assertEq("long season: whole tens, labelled gridlines, at least 30 points tall, inside 0 to 100",
    [lg.lo % 10, lg.hi % 10, lg.hi - lg.lo >= 30, lg.lo >= 0, lg.hi <= 100, lg.ticks[0], lg.ticks[lg.ticks.length - 1]], [0, 0, true, true, true, lg.lo, lg.hi]);
  assertEq("no normal season is drawn on 0 to 100", ["northgate", "mower", "inProgress", "long"].map((k) => { const s = sc(k); return s.lo === 0 && s.hi === 100; }), [false, false, false, false]);
  assertEq("the season line is always inside the scale", ["northgate", "mower", "inProgress", "long"].map((k) => { const s = sc(k), p = season(FIX[k]); return p >= s.lo && p <= s.hi; }), [true, true, true, true]);
  assertEq("tightly bunched games are not blown up: 50 to 52% spans 30 points, whole tens, all values inside", (() => { const s = T.trendScale([50, 51, 52], 51); return [s.hi - s.lo, s.lo % 10, s.hi % 10, s.lo <= 50 && s.hi >= 52]; })(), [30, 0, 0, true]);
  assertEq("a season at the top of the range stays within 100", T.trendScale([97, 100], 98.5), { lo: 70, hi: 100, ticks: [70, 80, 90, 100] });
  assertEq("a season near zero stays within 0", T.trendScale([0, 4], 2), { lo: 0, hi: 30, ticks: [0, 10, 20, 30] });
  assertEq("a wide season uses 20 point gridlines", T.trendScale([5, 95], 50).ticks, [0, 20, 40, 60, 80, 100]);
  assertEq("the scale is stated in words", T.scaleLabel({ lo: 40, hi: 70 }), "Scale 40% to 70%");
}

/* ---------------- B. points, groups, segments, helpers ---------------- */
console.log("\nB. Points, tournament groups and segments");
{
  const g = FIX.northgate;
  assertEq("a game with no plate appearances has no point", T.trendPoints([...g, { gameId: "x", pa: 0, qab: 0, qabPct: null }]).length, 5);
  assertEq("tournament groups are consecutive runs, in the order played",
    T.trendGroups(T.trendPoints(g)).map((x) => `${x.name}:${x.start}-${x.end}`), ["Fall Kickoff Classic:0-2", "Peach State Showdown:3-4"]);
  assertEq("games with no tournament form one unnamed group", T.trendGroups([{ tournament: null, tournamentId: null }, { tournament: null, tournamentId: null }]).map((x) => [x.name, x.start, x.end]), [["", 0, 1]]);
  assertEq("segments are solid only between two finished games (Northgate: 2 solid, 2 dotted)",
    T.trendSegments(T.trendPoints(g)).map((s) => s.provisional), [false, false, true, true]);
  assertEq("an open game in the middle makes both neighbouring segments dotted",
    T.trendSegments([{ completed: true }, { completed: false }, { completed: true }, { completed: true }]).map((s) => s.provisional), [true, true, false]);
  assertEq("all finished: no dotted segment", T.trendSegments(T.trendPoints(FIX.mower)).some((s) => s.provisional), false);
  assertEq("pointer position picks the nearest game and clamps at both ends", [T.indexAtX(-20, 0, 100, 5), T.indexAtX(0, 0, 100, 5), T.indexAtX(50, 0, 100, 5), T.indexAtX(99.9, 0, 100, 5), T.indexAtX(400, 0, 100, 5)], [0, 0, 2, 4, 4]);
  assertEq("keyboard: arrows, Home, End, Page keys, clamped", [T.indexForKey("ArrowLeft", 3, 6), T.indexForKey("ArrowRight", 3, 6), T.indexForKey("Home", 3, 6), T.indexForKey("End", 3, 6), T.indexForKey("ArrowLeft", 0, 6), T.indexForKey("ArrowRight", 5, 6), T.indexForKey("PageUp", 3, 6), T.indexForKey("PageDown", 3, 6), T.indexForKey("a", 3, 6)], [2, 4, 0, 5, 0, 5, 5, 0, 3]);
  assertEq("dates read as month and day", [T.shortDate("2026-10-04"), T.shortDate("2026-11-15"), T.shortDate(null), T.shortDate("bad")], ["Oct 4", "Nov 15", null, null]);
  assertEq("labels that would overlap are dropped", T.thinLabels([{ x: 0, text: "Mar 4" }, { x: 20, text: "Apr 4" }, { x: 60, text: "May 4" }]).map((l) => l.text), ["Mar 4", "May 4"]);
}

/* ---------------- C. rendering ---------------- */
console.log("\nC. Rendering");
const NG = html(FIX.northgate), MW = html(FIX.mower), IP = html(FIX.inProgress), LG = html(FIX.long);
{
  assertEq("Northgate: scale stated, labelled gridlines 40 to 70", [text(NG).includes("Scale 40% to 70%."), ["40%", "50%", "60%", "70%"].every((t) => NG.includes(`>${t}</text>`))], [true, true]);
  assertEq("Northgate: season line and its figure", [NG.includes('class="qtrend-season"'), NG.includes("Season 58.2%")], [true, true]);
  assertEq("Northgate: both tournaments are bands with names", [NG.includes(">Fall Kickoff Classic</text>"), NG.includes(">Peach State Showdown</text>"), count(NG, /class="qtrend-band"/g)], [true, true, 1]);
  assertEq("Northgate: its two open games are provisional points, the other three solid", [count(NG, /class="qtrend-dot prov"/g), count(NG, /class="qtrend-dot"/g)], [2, 3]);
  assertEq("Northgate: dotted segments for the open games, solid for the rest", [count(NG, /class="qtrend-seg prov"/g), count(NG, /class="qtrend-seg"/g)], [2, 2]);
  assertEq("Northgate: the readout opens on the latest game, marked provisional with an asterisk",
    [text(NG).includes("G5 Oct 4 vs Marietta Mavericks"), text(NG).includes("In progress, can still change"), text(NG).includes("61.5%*"), text(NG).includes("8 of 13 PA")], [true, true, true, true]);
  assertEq("Northgate: the asterisk is explained under the chart and in the key", [text(NG).includes("* In progress: still being tracked, so this percentage can change."), NG.includes("qtrend-key-live")], [true, true]);
  assertEq("Northgate: the W/L lane shows only the two recorded results", [count(NG, /class="qtrend-lane qtrend-lane-/g), NG.includes("qtrend-lane-w"), NG.includes("qtrend-lane-l")], [2, true, true]);
  assertEq("Northgate: the slider speaks the game in full",
    [NG.includes('role="slider"'), NG.includes('aria-valuemin="1"'), NG.includes('aria-valuemax="5"'), NG.includes('aria-valuenow="5"'), /aria-valuetext="Game 5, Oct 4 versus Marietta Mavericks, 61.5 percent, 8 of 13 plate appearances, in progress, can still change"/.test(NG), NG.includes('tabindex="0"')], [true, true, true, true, true, true]);
  assertEq("the drawing itself is hidden from assistive technology", NG.includes('<svg class="qtrend-svg"') && /<svg[^>]*aria-hidden="true"/.test(NG), true);

  assertEq("Mower: all 11 games finished, so no provisional point, segment, asterisk or pill",
    [count(MW, /class="qtrend-dot"/g), count(MW, /prov/g), MW.includes("In progress"), text(MW).includes("*")], [11, 0, false, false]);
  assertEq("Mower: scale 30 to 70, season 51.4%, two bands", [text(MW).includes("Scale 30% to 70%."), MW.includes("Season 51.4%"), count(MW, /class="qtrend-band"/g)], [true, true, 1]);
  assertEq("Mower: the lane carries every recorded result (1 T, 6 L, 4 W)", ["T", "L", "W"].map((r) => count(MW, new RegExp(`qtrend-lane-${r.toLowerCase()}"[^>]*>${r}<`, "g"))), [1, 6, 4]);
  assertEq("Mower: readout opens on the latest game with its result and score", [text(MW).includes("G11 Nov 15 vs Opponent K"), text(MW).includes("W"), text(MW).includes("10–5"), text(MW).includes("61.5%"), text(MW).includes("16 of 26 PA")], [true, true, true, true, true]);

  assertEq("in progress: only the open game is provisional, joined by one dotted segment", [count(IP, /class="qtrend-dot prov"/g), count(IP, /class="qtrend-dot"/g), count(IP, /class="qtrend-seg prov"/g), count(IP, /class="qtrend-seg"/g)], [1, 5, 1, 4]);
  assertEq("in progress: the readout is the open game, 55.6%* of 5 of 9, provisional", [text(IP).includes("G6 Oct 11 vs Roswell Rebels"), text(IP).includes("55.6%*"), text(IP).includes("5 of 9 PA"), text(IP).includes("In progress, can still change")], [true, true, true, true]);
  assertEq("in progress: the season line still counts the open game (62/107 = 57.9%)", [IP.includes("Season 57.9%")], [true]);
  assertEq("a score is shown when recorded", text(IP).includes("4–2"), true);
}

/* ---------------- D. one behaviour for every length ---------------- */
console.log("\nD. The same chart for a short and a long season");
{
  const classes = (h) => [...new Set((h.match(/class="([^"]+)"/g) ?? []).flatMap((m) => m.slice(7, -1).split(" ")))].filter((c) => c.startsWith("qtrend")).sort();
  const shortC = classes(html(FIX.mower)), longC = classes(LG);
  assertEq("24 games draw 24 points, 23 segments and no other chart", [count(LG, /class="qtrend-dot"/g), count(LG, /class="qtrend-seg"/g)], [24, 23]);
  assertEq("every element class of the 11-game chart is present in the 24-game chart", shortC.filter((c) => !longC.includes(c)), []);
  assertEq("and the 24-game chart introduces no element class of its own", longC.filter((c) => !shortC.includes(c)), []);
  assertEq("long season: scale stated, six tournament bands (three shaded), a slider over 24 games",
    [/Scale \d+% to \d+%\./.test(text(LG)), count(LG, /class="qtrend-sep"/g), count(LG, /class="qtrend-band"/g), LG.includes('aria-valuemax="24"')], [true, 5, 3, true]);
  assertEq("long season: lane letters stay small enough to sit side by side", LG.includes("font-size:8.5"), true);
  assertEq("two games still draw the chart (the smallest trend)", count(html(FIX.mower.slice(0, 2)), /class="qtrend-dot"/g), 2);
  assertEq("one game is stated, not drawn", (() => { const h = html(FIX.mower.slice(0, 1)); return [h.includes("<svg"), text(h).includes("A second tracked game will start the trend.")]; })(), [false, true]);
  assertEq("one game still being tracked says it can change", (() => { const h = html(FIX.inProgress.slice(5)); return [h.includes("<svg"), text(h).includes("55.6%*"), text(h).includes("can change")]; })(), [false, true, true]);
  assertEq("no games: nothing is drawn", html([]), "");
}

/* ---------------- E. stylesheet ---------------- */
console.log("\nE. Stylesheet");
const CSS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
const BLOCK_START = "/* --- QAB% by game ---", BLOCK_END = "/* --- QAB tracker: resume selector";
const chartCss = CSS.slice(CSS.indexOf(BLOCK_START), CSS.indexOf(BLOCK_END));
{
  const rule = (css, sel) => (css.match(new RegExp(`${sel.replace(/[.]/g, "\\.")} \\{[^}]*\\}`)) ?? [""])[0];
  const phone = chartCss.slice(chartCss.indexOf("@media (max-width: 560px)"));
  const px = (r, prop) => Number((r.match(new RegExp(`${prop}: (\\d+)px`)) ?? [])[1]);
  assertEq("the desktop readout is compact and the phone readout is larger", [px(rule(chartCss, ".qtrend-ro"), "min-height") <= 32, px(rule(phone, ".qtrend-ro"), "min-height") >= 56], [true, true]);
  assertEq("the phone readout's percentage is large", px(rule(phone, ".qtrend-ro-pct"), "font-size") >= 20, true);
  assertEq("the phone readout also names the tournament (the bands are unlabelled there)", [rule(chartCss, ".qtrend-ro-t").includes("display: none"), rule(phone, ".qtrend-ro-t").includes("display: block")], [true, true]);
  assertEq("the slider scrubs horizontally and leaves vertical scroll alone", rule(chartCss, ".qtrend-hit").includes("touch-action: pan-y"), true);
  assertEq("the slider shows a focus ring for keyboard users", /\.qtrend-hit:focus-visible \{[^}]*outline: 2px solid/.test(chartCss), true);
  assertEq("provisional marks are dotted and hollow", [/\.qtrend-seg\.prov \{[^}]*stroke-dasharray/.test(chartCss), /\.qtrend-dot\.prov \{[^}]*fill: var\(--surface\)[^}]*stroke-dasharray/.test(chartCss)], [true, true]);
  assertEq("the old label strip is gone and the drawing is never stretched", [/qtrend-label/.test(CSS), /preserveAspectRatio/.test(fs.readFileSync(path.join(ROOT, "components/PerformanceSeason.js"), "utf8"))], [false, false]);
}

/* ---------------- F. nothing else on Performance moved ---------------- */
console.log("\nF. Everything else is unchanged");
{
  const rev = process.env.QAB_BASE_REV || "HEAD";
  const show = (f) => { try { return execSync(`git show ${rev}:${f}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } };
  const comp = fs.readFileSync(path.join(ROOT, "components/PerformanceSeason.js"), "utf8");
  const baseComp = show("components/PerformanceSeason.js"), baseCss = show("app/globals.css");
  if (baseComp == null || baseCss == null) console.log(`  note  ${rev} is not available here; the unchanged-elsewhere comparison is skipped`);
  else {
    const cut = (s, a, b) => s.slice(0, s.indexOf(a)) + s.slice(s.indexOf(b));
    const trimComp = (s) => cut(s, "/**\n * Team QAB% per game, in date order", "/**\n * The expanded player panel.").replace(/import \{ use[A-Za-z, ]+ \} from "react";[\s\S]*?(?=\n\/\*\*)/, "")
      // 2026-11-22: the one approved change, the Performance player card no longer draws per-game dots.
      .replace(" showDots={false}", "");
    // Both revisions may already carry the redesigned chart (the comparison base can be a later commit),
    // so compare with the chart function and the import preamble removed from each side.
    assertEq("PerformanceSeason.js is identical outside QabTrend and its imports", trimComp(comp), trimComp(baseComp));
    assertEq("globals.css is identical outside the QAB% by game block", cut(CSS, BLOCK_START, BLOCK_END), cut(baseCss, BLOCK_START, BLOCK_END));
  }
  assertEq("the season figure is still the page's own team.qabPct", /<QabTrend games=\{games\} seasonPct=\{team\.qabPct\} \/>/.test(comp), true);
}

console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
