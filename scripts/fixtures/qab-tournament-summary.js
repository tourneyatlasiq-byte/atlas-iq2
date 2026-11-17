/**
 * Fixture for the Tournament QAB report checks (2026-11): the payload the page
 * receives for the approved Mower weekend, with EVERY name replaced (the
 * repository is public): players, opponents, tournaments, team and club.
 * Counts, scores, dates and times are the real values:
 *
 *   81 QAB / 149 PA = 54.4% over 6 games; record 4-2; runs 47 / 27;
 *   day 1 30/65 = 46.2%, day 2 51/84 = 60.7%; highest G4 64.3%, lowest G3 36.0%;
 *   previous tracked tournament 51/108 = 47.2%.
 *
 * Used by check-qab-tournament-render.js and verify-qab-tournament-layout.js.
 */


const G = [
  [1, "Sat Nov 14", "08:00:00", "Opponent One", "L", 4, 6, 10, 21],
  [2, "Sat Nov 14", "11:00:00", "Opponent Two Long Team Name Alpha/Bravo", "L", 5, 9, 11, 19],
  [3, "Sat Nov 14", "14:00:00", "Opponent Three", "W", 5, 4, 9, 25],
  [4, "Sun Nov 15", "08:00:00", "Opponent Four", "W", 11, 3, 18, 28],
  [5, "Sun Nov 15", "11:00:00", "Opponent Five Cole/Fowler", "W", 12, 0, 17, 30],
  [6, "Sun Nov 15", "14:30:00", "Opponent Six", "W", 10, 5, 16, 26],
].map(([number, day, time, opponent, result, runsFor, runsAgainst, qab, pa]) => ({
  id: `g${number}`, number, day, time, opponent, result, runsFor, runsAgainst, qab, pa, qabPct: Math.round((qab / pa) * 1000) / 10,
}));
const NAMES = {
  "Aspen Hale": [[0,2],[1,2],[0,2],[1,3],[2,3],[2,3]], "Briar Cole": [[2,2],[1,2],[0,2],[1,3],[1,3],[2,2]],
  "Cedar Finch": [[0,2],[1,2],[1,2],[1,2],[2,3],[2,2]], "Dune Ellis": [[1,2],[0,2],[1,3],[2,3],[2,3],[1,3]],
  "Ember Shaw": [[1,2],[2,2],[1,2],[2,3],[2,3],[1,2]], "Fable Reed": [[2,3],[2,2],[1,3],[3,3],[2,3],[2,3]],
  "Garnet Pike": [[2,2],[1,2],[2,3],[2,3],[2,3],[3,3]], "Haven Roy": [[1,2],[0,1],[0,3],[1,2],[0,3],[0,2]],
  "Indigo Lane": [[0,2],[2,2],[1,3],[3,3],[2,3],[1,3]], "Juniper Voss": [[1,2],[1,2],[2,2],[2,3],[2,3],[2,3]],
};
const PLAYERS = Object.entries(NAMES).map(([name, cells]) => {
  const qab = cells.reduce((n, c) => n + c[0], 0), pa = cells.reduce((n, c) => n + c[1], 0);
  return { name, games: 6, qab, pa, qabPct: Math.round((qab / pa) * 1000) / 10, qabGames: cells.filter((c) => c[0] > 0).length, byGame: cells.map(([q, p]) => ({ qab: q, pa: p })) };
}).sort((a, b) => a.name.localeCompare(b.name));
const REASONS = [["Hit", 50], ["Walk", 12], ["Situational success", 8], ["Hard hit ball", 5], ["HBP", 2], ["Sac bunt", 2], ["Sac fly", 2]]
  .map(([label, count]) => ({ label, count, percent: Math.round((count / 81) * 1000) / 10 }));

const PACK = {
  generatedAt: "2026-11-17T12:00:00Z",
  organization: { name: "Fixture Club", logoUrl: null },
  team: { name: "Fixture Team" },
  season: { name: "2026-27" },
  tournament: { name: "Fixture Weekend Classic", dates: "Nov 14–15, 2026" },
  summary: { qabPct: 54.4, qab: 81, pa: 149, games: 6 },
  games: G,
  tournamentSummary: {
    record: { w: 4, l: 2, t: 0, played: 6 },
    runs: { scored: 47, allowed: 27, games: 6 },
    scope: { resultGames: 6, trackedGames: 6, untrackedResultGames: 0 },
    previous: { name: "Previous Weekend Classic", qab: 51, pa: 108, qabPct: 47.2 },
    days: [
      { date: "2026-11-14", label: "Sat Nov 14", qab: 30, pa: 65, qabPct: 46.2, games: 3 },
      { date: "2026-11-15", label: "Sun Nov 15", qab: 51, pa: 84, qabPct: 60.7, games: 3 },
    ],
    highest: 4,
    lowest: 3,
  },
  reasons: REASONS,
  reasonsCited: 81,
  players: PLAYERS,
  notes: [],
};

module.exports = { PACK, NAMES, PLAYERS, REASONS, G };
