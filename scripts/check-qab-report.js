/**
 * Regression cases for the QAB Performance report payload.
 *
 * Two risks this guards. First, a figure that disagrees with the Performance
 * screen — the report must reconcile, so it re-derives nothing. Second, the
 * product deciding a real recorded percentage is unworthy of display: there is
 * no minimum-PA threshold, and these cases pin that at every sample size.
 *
 * Exercises the payload's shaping rules against the real production shapes,
 * with getSeasonPerformance stubbed so no database or browser is needed.
 *
 * Run:  node scripts/check-qab-report.js
 */
const { pathToFileURL } = require("url");
const path = require("path");
const fs = require("fs");

let failures = 0;
let ran = 0;

function assertEq(label, actual, expected) {
  ran += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

/**
 * A per-player history of n games, carrying the same per-game fields the real
 * playerGameHistory() produces — so if the payload ever passed the array
 * through instead of its length, the allowlist assertions would catch it.
 */
function hist(n) {
  return Array.from({ length: n }, (_, i) => ({
    gameId: `g${i + 1}`, opponent: `Opponent ${i + 1}`, gameDate: "2026-08-05",
    battingOrder: 1, playerId: "p?", name: "Player", pa: 2, qab: 1, qabPct: 50,
  }));
}

/** Northgate's real season, as the derivation returns it. */
function northgate() {
  return {
    team: { pa: 98, qab: 57, qabPct: 58.2, games: 6, players: 13, tournaments: 3 },
    reasonsCited: 58,
    reasons: [
      { key: "walk", label: "Walk", count: 15 },
      { key: "hit", label: "Hit", count: 11 },
      { key: "situation_success", label: "Situational success", count: 7 },
      { key: "sac_fly", label: "Sac fly", count: 6 },
      { key: "hard_hit", label: "Hard hit ball", count: 5 },
      { key: "sac_bunt", label: "Sac bunt", count: 5 },
      { key: "eight_pitch", label: "8+ pitch", count: 5 },
      { key: "hbp", label: "HBP", count: 4 },
      { key: "unused", label: "Never cited", count: 0 },
    ],
    games: [
      { gameId: "g1", gameDate: "2026-08-05", opponent: "Northside Thunder", result: "W", qab: 9, pa: 14, qabPct: 64.3 },
      { gameId: "g2", gameDate: "2026-08-05", opponent: "Cobb Crush", result: "W", qab: 12, pa: 25, qabPct: 48 },
      { gameId: "g3", gameDate: "2026-08-06", opponent: "Lake City Lightning", result: "L", qab: 15, pa: 25, qabPct: 60 },
      { gameId: "g4", gameDate: "2026-10-03", opponent: "Peachtree Force", result: null, qab: 12, pa: 20, qabPct: 60 },
      { gameId: "g5", gameDate: "2026-10-04", opponent: "Marietta Mavericks", result: null, qab: 8, pa: 13, qabPct: 61.5 },
      { gameId: "g6", gameDate: "2026-08-04", opponent: "Test", result: "W", qab: 1, pa: 1, qabPct: 100 },
    ],
    players: [
      // Real production spread, including the small samples. history LENGTH is
      // the games-batted count the report now reads, so these mirror the real
      // per-player game counts rather than being placeholders.
      { playerId: "p1", name: "Bella Ramos", qab: 11, pa: 14, qabPct: 78.6, history: hist(6), recentForm: { qabPct: 80 } },
      { playerId: "p2", name: "Gia Castellano", qab: 8, pa: 10, qabPct: 80, history: hist(5), recentForm: null },
      { playerId: "p3", name: "Jada Sinclair", qab: 6, pa: 10, qabPct: 60, history: hist(5), recentForm: null },
      { playerId: "p4", name: "Delaney Boyd", qab: 6, pa: 7, qabPct: 85.7, history: hist(5), recentForm: null },
      { playerId: "p5", name: "Cora Lindqvist", qab: 1, pa: 3, qabPct: 33.3, history: hist(2), recentForm: null },
      { playerId: "p6", name: "Solo Sample", qab: 1, pa: 1, qabPct: 100, history: hist(1), recentForm: null },
      { playerId: "p7", name: "Zero Sample", qab: 0, pa: 4, qabPct: 0, history: hist(3), recentForm: null },
    ],
    gamesCompleted: 3,
    record: { w: 3, l: 1, t: 0 },
    participantCount: 12,
  };
}

let loadCount = 0;

/** Loads the payload module with getSeasonPerformance and the client stubbed. */
async function loadWith(seasonData) {
  const src = fs
    .readFileSync(path.resolve("lib/queries/reports/qab-performance.js"), "utf8")
    .replace('import { createClient } from "../../supabase/server";\n', "")
    .replace('import { getSeasonPerformance } from "../performance";\n', "");

  const stub = `
const createClient = () => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { name: "2026-27", team: { name: "Northgate 16U Gold",
                  organization: { name: "Northgate Fastpitch", logo_url: null } } },
        }),
      }),
    }),
  }),
});
const getSeasonPerformance = async () => (${JSON.stringify(seasonData)});
`;
  // Unique per load: two loads in the same millisecond used to share one file
  // name, and Node's import cache then served the FIRST payload module to the
  // second load — an intermittent false failure.
  const out = "/tmp/qab_payload_" + Date.now() + "_" + (++loadCount) + ".mjs";
  fs.writeFileSync(out, stub + src);
  return import(pathToFileURL(out).href);
}

(async () => {
  console.log("\nQAB Performance report payload\n");

  const mod = await loadWith(northgate());
  const r = await mod.qabPerformanceReport("season-1");

  /* 1. Totals reconcile to the derivation, not re-derived. */
  assertEq("team totals come straight from the derivation",
    [r.summary.qabPct, r.summary.qab, r.summary.pa, r.summary.games, r.summary.players],
    [58.2, 57, 98, 6, 13]);

  /* 2. Every tracked player appears. */
  assertEq("all seven tracked players appear", r.players.length, 7);

  /* 3 & 4. No PA threshold, at any sample size. */
  const by = (n) => r.players.find((p) => p.name === n);
  assertEq("a 7-PA player still shows her real percentage",
    [by("Delaney Boyd").qab, by("Delaney Boyd").pa, by("Delaney Boyd").qabPct], [6, 7, 85.7]);
  assertEq("a 3-PA player still shows her real percentage",
    [by("Cora Lindqvist").pa, by("Cora Lindqvist").qabPct], [3, 33.3]);
  assertEq("a 1-PA player still shows her real percentage",
    [by("Solo Sample").pa, by("Solo Sample").qabPct], [1, 100]);
  assertEq("a genuine 0% is shown, not suppressed",
    [by("Zero Sample").pa, by("Zero Sample").qabPct], [4, 0]);
  assertEq("no player row carries a threshold or eligibility flag",
    Object.keys(by("Cora Lindqvist")).sort(), ["games", "name", "pa", "qab", "qabPct"]);

  /* 3b. Games played: read from the derivation's history, never recomputed. */
  assertEq("games is the length of the history the derivation already built",
    [by("Bella Ramos").games, by("Gia Castellano").games, by("Cora Lindqvist").games],
    [6, 5, 2]);
  assertEq("games is not inferred from PA — 3 PA across 2 games, 4 PA across 3",
    [[by("Cora Lindqvist").games, by("Cora Lindqvist").pa],
     [by("Zero Sample").games, by("Zero Sample").pa]],
    [[2, 3], [3, 4]]);
  assertEq("a 1-game player is carried, not suppressed",
    [by("Solo Sample").games, by("Solo Sample").pa], [1, 1]);
  assertEq("games never exceeds the season's tracked game count",
    r.players.every((p) => p.games <= r.summary.games), true);
  assertEq("games is a number, never a nested object or array",
    r.players.every((p) => typeof p.games === "number"), true);

  /* 5. Deterministic order: QAB% desc, PA desc, name. */
  assertEq("sorted by QAB%, then PA, then name",
    r.players.map((p) => p.name),
    ["Solo Sample", "Delaney Boyd", "Gia Castellano", "Bella Ramos",
     "Jada Sinclair", "Cora Lindqvist", "Zero Sample"]);

  /* 6. Game order is the derivation's chronological order, preserved. */
  assertEq("game order is preserved from the derivation",
    r.games.map((g) => g.id), ["g1", "g2", "g3", "g4", "g5", "g6"]);

  /* 7 & 8. Result is context only; no outcome aggregate exists. */
  assertEq("result travels with its own game",
    r.games.map((g) => g.result), ["W", "W", "L", null, null, "W"]);
  const flat = JSON.stringify(r).toLowerCase();
  assertEq("no wins-vs-losses aggregate anywhere in the payload",
    ["winsqab", "lossesqab", "byresult", "outcomegroup", "wins:", "losses:", "correlation"]
      .some((k) => flat.includes(k)), false);
  assertEq("payload has no top-level record or outcome grouping",
    ["record", "wins", "losses", "ties"].some((k) => k in r), false);

  /* 9. Reasons reconcile, and share is of reasons cited — not of QABs. */
  assertEq("reason counts total reasonsCited",
    r.reasons.reduce((n, x) => n + x.count, 0), r.reasonsCited);
  assertEq("reasonsCited matches the derivation", r.reasonsCited, 58);
  assertEq("zero-count reasons are dropped, not printed as empty bars",
    r.reasons.some((x) => x.count === 0), false);
  assertEq("reasons are ordered by count", r.reasons.map((x) => x.count),
    [15, 11, 7, 6, 5, 5, 5, 4]);
  assertEq("share is of reasons cited (15/58), not of QABs",
    r.reasons[0].percent, 25.9);

  /* 10. Allowlist. */
  assertEq("top-level keys are exactly the allowlist",
    Object.keys(r).sort(),
    ["games", "generatedAt", "organization", "players", "reasons", "reasonsCited",
     "season", "summary", "team"]);
  assertEq("game rows carry no scores or internal ids beyond the row key",
    Object.keys(r.games[0]).sort(), ["date", "id", "opponent", "pa", "qab", "qabPct", "result"]);
  assertEq("NO playerId — the parent player report cannot be built by filtering this",
    r.players.every((p) => !("playerId" in p)), true);
  assertEq("no per-player history, trend or recent form leaks through",
    r.players.every((p) => !("history" in p) && !("recentForm" in p) && !("reasons" in p)), true);
  assertEq("no lineup, batting order, tournament or score fields",
    ["battingorder", "lineup", "runs_for", "runs_against", "tournamentid", "participantcount"]
      .some((k) => flat.includes(k)), false);

  /* 13 & 14. Partial data does not break the report. */
  const noResults = northgate();
  noResults.games = noResults.games.map((g) => ({ ...g, result: null }));
  const r2 = await (await loadWith(noResults)).qabPerformanceReport("s");
  assertEq("every result missing still yields all games",
    [r2.games.length, r2.games.every((g) => g.result === null)], [6, true]);

  const noReasons = northgate();
  noReasons.reasons = noReasons.reasons.map((x) => ({ ...x, count: 0 }));
  noReasons.reasonsCited = 0;
  const r3 = await (await loadWith(noReasons)).qabPerformanceReport("s");
  assertEq("no reasons cited yields an empty list, not invented distribution",
    [r3.reasons.length, r3.reasonsCited], [0, 0]);

  /* A derivation that stops supplying history must not print a false zero. */
  const noHistory = northgate();
  noHistory.players = noHistory.players.map(({ history, ...rest }) => rest);
  const r5 = await (await loadWith(noHistory)).qabPerformanceReport("s");
  assertEq("missing history yields null games, never 0 beside a real PA count",
    [r5.players.every((p) => p.games === null), r5.players.find((p) => p.name === "Bella Ramos").pa],
    [true, 14]);
  assertEq("player order is unaffected by a missing games count",
    r5.players.map((p) => p.name),
    ["Solo Sample", "Delaney Boyd", "Gia Castellano", "Bella Ramos",
     "Jada Sinclair", "Cora Lindqvist", "Zero Sample"]);

  const untracked = northgate();
  untracked.team = { pa: 0, qab: 0, qabPct: null, games: 0, players: 0, tournaments: 0 };
  untracked.games = [];
  untracked.players = [];
  const r4 = await (await loadWith(untracked)).qabPerformanceReport("s");
  assertEq("an untracked season reports null percent, not a manufactured 0%",
    [r4.summary.qabPct, r4.summary.pa, r4.games.length, r4.players.length], [null, 0, 0, 0]);

  
/* ---- Season scoping and terminology ------------------------------------ */

{
  const fsx = require("fs");
  const perf = fsx.readFileSync("lib/queries/performance.js", "utf8");
  const rules = fsx.readFileSync("lib/qab-rules.js", "utf8");
  // This suite stubs its module graph, so load the real rules directly.
  const qab = await import(pathToFileURL(path.resolve("lib/qab-rules.js")).href);

  // The W/L/T record was read organization-wide with a comment claiming RLS
  // supplied the scope. RLS scopes by ORGANIZATION, not season, so a second
  // season would have shown a lifetime record beside season-scoped QAB.
  assertEq("the record query is season-scoped",
    /\.from\("games"\)\s*\n\s*\.select\("result"\)\s*\n\s*\.eq\("season_id", seasonId\)/.test(perf), true);
  assertEq("...and the misleading RLS comment is gone",
    /Scoped by RLS like every other query here/.test(perf), false);
  assertEq("...replaced by what RLS actually does",
    /RLS scopes\s*\n?\s*\* by ORGANIZATION, not by season/.test(perf), true);

  // QAB remains independently season-scoped.
  assertEq("QAB stays filtered by season", /\.eq\("season_id", seasonId\)/.test(perf), true);
  assertEq("...and still excludes voided plate appearances",
    /\.is\("voided_at", null\)/.test(perf), true);

  // Terminology: display only.
  assertEq("the reason label reads Situational success",
    qab.reasonLabel("situation_success"), "Situational success");
  assertEq("...while the stored key is unchanged",
    qab.REASON_KEYS.includes("situation_success"), true);
  assertEq("...and the key is still the one the constraint expects",
    /key: "situation_success"/.test(rules), true);
  assertEq("no user-facing copy still says Situation success",
    /"Situation success"/.test(rules), false);
}

/* ---- Report presentation polish (2026-11) ------------------------------ */

{
  const fsx = require("fs");
  const qab = await import(pathToFileURL(path.resolve("lib/qab-rules.js")).href);
  const comp = fsx.readFileSync("components/reports/QabPerformanceReport.js", "utf8");
  const css = fsx.readFileSync("app/reports/qab-performance/qab.css", "utf8");

  // Precision: one decimal, always.
  assertEq("50 prints as 50.0%", qab.formatQabPct(50), "50.0%");
  assertEq("10 prints as 10.0%", qab.formatQabPct(10), "10.0%");
  assertEq("45.5 is unchanged", qab.formatQabPct(45.5), "45.5%");
  assertEq("0 is a real 0.0%, not a dash", qab.formatQabPct(0), "0.0%");
  assertEq("100 prints as 100.0%", qab.formatQabPct(100), "100.0%");
  assertEq("null (no PA) is a dash, never 0.0%", qab.formatQabPct(null), "\u2014");
  assertEq("the report formats through the shared rule",
    /const pct = formatQabPct;/.test(comp), true);
  assertEq("...and no bespoke `${v}%` formatter remains",
    /`\$\{v\}%`/.test(comp), false);

  // Result column: present only when a game in scope has a result.
  assertEq("Result visibility is derived from the games in scope",
    /const showResult = games\.some\(\(g\) => Boolean\(g\.result\)\);/.test(comp), true);
  assertEq("the Result header is conditional",
    /\{showResult && <th className="qab-c-res">Result<\/th>\}/.test(comp), true);
  assertEq("the Result cell is conditional",
    /\{showResult && \(\s*<td className="qab-c-res">/.test(comp), true);
  assertEq("result is still never aggregated",
    /wins|losses|winPct/.test(comp.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), false);

  // Print density: space from padding only, no type changes.
  const print = css.slice(css.indexOf("@media print"));
  assertEq("print reclaims table row padding",
    /\.qab-table td \{ padding-top: 4px; padding-bottom: 4px; \}/.test(print), true);
  assertEq("print reclaims reason row padding", /\.qab-reasons li \{ padding: 2px 0; \}/.test(print), true);
  assertEq("print changes no font size beyond the existing hero rule",
    (print.match(/font-size/g) || []).length, 1);

  // Hero: no players-tracked line; the payload still carries the figure.
  assertEq("the hero no longer prints a players-tracked line",
    /players"\} tracked|player tracked|players tracked<\/li>/.test(comp), false);
  assertEq("...while QAB / PA and games tracked remain",
    [/QAB \/ <strong>\{summary\.pa\}<\/strong> PA/.test(comp), /games"\} tracked/.test(comp)], [true, true]);

  // Phone reasons: two-line rows on screen at phone width only.
  const phone = css.slice(css.indexOf("@media screen and (max-width: 560px)"), css.indexOf("@media print"));
  assertEq("phone reason layout is screen-only and sits before the print rules",
    css.indexOf("@media screen and (max-width: 560px)") > 0 && css.indexOf("@media screen and (max-width: 560px)") < css.indexOf("@media print"), true);
  assertEq("on phones the bar spans the full row beneath the label",
    /\.qab-reason-bar\s+\{ grid-column: 1 \/ -1; grid-row: 2;/.test(phone), true);
  assertEq("the desktop reason grid is unchanged",
    /grid-template-columns: minmax\(0, 9\.5em\) minmax\(0, 1fr\) 2\.4em 3\.4em;/.test(css.slice(0, css.indexOf("@media screen"))), true);
  assertEq("print does not restyle reason bars",
    /qab-reason-bar/.test(print), false);
}

console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
