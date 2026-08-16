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

/** Northgate's real season, as the derivation returns it. */
function northgate() {
  return {
    team: { pa: 98, qab: 57, qabPct: 58.2, games: 6, players: 13, tournaments: 3 },
    reasonsCited: 58,
    reasons: [
      { key: "walk", label: "Walk", count: 15 },
      { key: "hit", label: "Hit", count: 11 },
      { key: "situation_success", label: "Situation success", count: 7 },
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
      // Real production spread, including the small samples.
      { playerId: "p1", name: "Bella Ramos", qab: 11, pa: 14, qabPct: 78.6, history: [{ x: 1 }], recentForm: { qabPct: 80 } },
      { playerId: "p2", name: "Gia Castellano", qab: 8, pa: 10, qabPct: 80, history: [], recentForm: null },
      { playerId: "p3", name: "Jada Sinclair", qab: 6, pa: 10, qabPct: 60, history: [], recentForm: null },
      { playerId: "p4", name: "Delaney Boyd", qab: 6, pa: 7, qabPct: 85.7, history: [], recentForm: null },
      { playerId: "p5", name: "Cora Lindqvist", qab: 1, pa: 3, qabPct: 33.3, history: [], recentForm: null },
      { playerId: "p6", name: "Solo Sample", qab: 1, pa: 1, qabPct: 100, history: [], recentForm: null },
      { playerId: "p7", name: "Zero Sample", qab: 0, pa: 4, qabPct: 0, history: [], recentForm: null },
    ],
    gamesCompleted: 3,
    record: { w: 3, l: 1, t: 0 },
    participantCount: 12,
  };
}

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
  const out = "/tmp/qab_payload_" + Date.now() + ".mjs";
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
    Object.keys(by("Cora Lindqvist")).sort(), ["name", "pa", "qab", "qabPct"]);

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

  const untracked = northgate();
  untracked.team = { pa: 0, qab: 0, qabPct: null, games: 0, players: 0, tournaments: 0 };
  untracked.games = [];
  untracked.players = [];
  const r4 = await (await loadWith(untracked)).qabPerformanceReport("s");
  assertEq("an untracked season reports null percent, not a manufactured 0%",
    [r4.summary.qabPct, r4.summary.pa, r4.games.length, r4.players.length], [null, 0, 0, 0]);

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
