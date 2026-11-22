/**
 * Season by tournament, and a player's games with a QAB (2026-11).
 *
 * PURE rules, no database and no server imports, so the Performance screen,
 * the Season report and the Player report all read the same derivation.
 *
 * Inputs are what getSeasonPerformance already returns: games with their
 * tournament, aggregate QAB/PA and an explicit `completed` flag, and a player's
 * history (one entry per game in which she recorded a plate appearance).
 * Nothing here queries, re-counts plate appearances, or invents a value.
 *
 * Rules this file owns:
 *   - "Tracking in progress" is a per-game fact from `completed`. It is never
 *     inferred from tournament dates, and finishing one game does not imply
 *     the tournament is over.
 *   - A tournament is flagged `trackingInProgress` when any of its games is
 *     unfinished. A row is `includesUnfinished` (the striped, provisional bar)
 *     only when the figures on THAT row include a plate appearance from an
 *     unfinished game.
 *   - A game where the player did not bat is "no PA recorded". It is never a
 *     zero percent and never counted in her games-with-a-PA denominator.
 *   - Without start times a day has no knowable sequence, so games are placed
 *     in a stable order (opponent, then id) and the day is flagged.
 *   - No ids leave a row. Names and aggregate counts only.
 */
import { qabPercent } from "./qab-rules";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const NO_TOURNAMENT_LABEL = "Not in a tournament";

function parts(iso) {
  const [y, m, d] = String(iso ?? "").split("-").map(Number);
  return y && m && d ? { y, m, d } : null;
}

/** "Nov 6" (local, never shifted by a time zone). */
export function shortDay(iso) {
  const p = parts(iso);
  return p ? `${MONTHS[p.m - 1]} ${p.d}` : null;
}

/** "Nov 6 to 7" · "Nov 13" · "Nov 30 to Dec 2". Built from tracked games only. */
export function tournamentDateLabel(firstIso, lastIso) {
  const a = parts(firstIso);
  const b = parts(lastIso);
  if (!a) return null;
  if (!b || (a.m === b.m && a.d === b.d && a.y === b.y)) return shortDay(firstIso);
  if (a.m === b.m && a.y === b.y) return `${MONTHS[a.m - 1]} ${a.d} to ${b.d}`;
  return `${shortDay(firstIso)} to ${shortDay(lastIso)}`;
}

const byDateThenName = (a, b) =>
  String(a.gameDate ?? "").localeCompare(String(b.gameDate ?? "")) ||
  String(a.gameId ?? "").localeCompare(String(b.gameId ?? ""));

/** Groups games by tournament, in order of first game date, no-tournament last. */
function groupByTournament(games) {
  const map = new Map();
  for (const g of [...(games ?? [])].sort(byDateThenName)) {
    const key = g.tournamentId ?? null;
    const entry = map.get(key) ?? {
      name: g.tournament || (key == null ? NO_TOURNAMENT_LABEL : "Tournament"),
      games: [],
    };
    entry.games.push(g);
    map.set(key, entry);
  }
  const groups = [...map.entries()].map(([key, v]) => ({ key, ...v }));
  const first = (grp) => grp.games[0]?.gameDate ?? "";
  return groups.sort(
    (a, b) =>
      (a.key == null) - (b.key == null) ||
      first(a).localeCompare(first(b)) ||
      a.name.localeCompare(b.name)
  );
}

function span(gamesInGroup) {
  const dates = gamesInGroup.map((g) => g.gameDate).filter(Boolean).sort();
  return { firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null };
}

/** Team rows: aggregate QAB/PA per tournament. */
export function tournamentRows(games) {
  return groupByTournament(games).map((grp) => {
    const qab = grp.games.reduce((n, g) => n + (g.qab ?? 0), 0);
    const pa = grp.games.reduce((n, g) => n + (g.pa ?? 0), 0);
    return {
      name: grp.name,
      games: grp.games.length,
      qab,
      pa,
      qabPct: qabPercent(qab, pa),
      trackingInProgress: grp.games.some((g) => !g.completed),
      includesUnfinished: grp.games.some((g) => !g.completed && (g.pa ?? 0) > 0),
      ...span(grp.games),
    };
  });
}

/** One tournament is just the season; the breakdown earns its place from two. */
export function showTournamentRows(rows) {
  return (rows ?? []).length >= 2;
}

function dotLabel(g, mine) {
  const day = shortDay(g.gameDate);
  const head = `${day ?? "Game"}${g.opponent ? `, vs ${g.opponent}` : ""}`;
  if (mine.pa <= 0) {
    return `${head}: no plate appearance recorded for this player`;
  }
  const counts = `${mine.qab} QAB in ${mine.pa} PA`;
  const body =
    mine.qab > 0 ? `QAB recorded, ${counts}` : `batted, no QAB recorded, ${counts}`;
  return `${head}: ${body}${g.completed ? "" : ". Tracking in progress"}`;
}

function buildDays(gamesInGroup, mineById) {
  const byDay = new Map();
  for (const g of gamesInGroup) {
    const k = g.gameDate ?? "";
    byDay.set(k, [...(byDay.get(k) ?? []), g]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const timesKnown = list.every((g) => Boolean(g.startTime));
      const ordered = [...list].sort((a, b) =>
        timesKnown
          ? String(a.startTime).localeCompare(String(b.startTime)) ||
            String(a.gameId).localeCompare(String(b.gameId))
          : String(a.opponent ?? "").localeCompare(String(b.opponent ?? ""), undefined, {
              sensitivity: "base",
            }) || String(a.gameId).localeCompare(String(b.gameId))
      );
      return {
        date,
        label: shortDay(date),
        timesKnown,
        games: ordered.map((g) => {
          const mine = mineById.get(g.gameId) ?? { qab: 0, pa: 0 };
          const status = mine.pa <= 0 ? "nopa" : mine.qab > 0 ? "qab" : "noqab";
          return {
            gameId: g.gameId,
            dayLabel: shortDay(g.gameDate),
            opponent: g.opponent ?? null,
            status,
            qab: mine.qab,
            pa: mine.pa,
            unfinished: mine.pa > 0 && !g.completed,
            label: dotLabel(g, mine),
          };
        }),
      };
    });
}

/**
 * A player's view: per-tournament rows and per-game dots, from her own history.
 * `history` entries need { gameId, qab, pa } (playerGameHistory already
 * returns those, and already omits games with no PA).
 */
export function playerTournamentView(games, history) {
  const mineById = new Map();
  for (const h of history ?? []) {
    if (h?.gameId != null) mineById.set(h.gameId, { qab: h.qab ?? 0, pa: h.pa ?? 0 });
  }
  const groups = groupByTournament(games);

  const rows = groups.map((grp) => {
    let qab = 0, pa = 0, gamesWithPa = 0, gamesWithQab = 0, unfinished = false;
    for (const g of grp.games) {
      const m = mineById.get(g.gameId);
      if (!m || m.pa <= 0) continue;
      qab += m.qab; pa += m.pa; gamesWithPa += 1;
      if (m.qab > 0) gamesWithQab += 1;
      if (!g.completed) unfinished = true;
    }
    return {
      name: grp.name,
      games: grp.games.length,
      qab,
      pa,
      qabPct: qabPercent(qab, pa),
      gamesWithPa,
      gamesWithQab,
      trackingInProgress: grp.games.some((g) => !g.completed),
      includesUnfinished: unfinished,
      ...span(grp.games),
    };
  });

  const dots = groups.map((grp) => ({
    name: grp.name,
    days: buildDays(grp.games, mineById),
  }));

  return {
    rows,
    dots,
    gamesWithPa: rows.reduce((n, r) => n + r.gamesWithPa, 0),
    gamesWithQab: rows.reduce((n, r) => n + r.gamesWithQab, 0),
    anyProvisional: rows.some((r) => r.includesUnfinished),
  };
}

/**
 * The left-hand count on a player's tournament row: "3 games with a PA", or
 * "No PA recorded". Never "0 of 1 game": a game she did not bat in is not part
 * of her sample, and the dots already show it.
 */
export function playerRowSummary(row) {
  const n = row?.gamesWithPa ?? 0;
  if (n <= 0 || (row?.pa ?? 0) <= 0) return "No PA recorded";
  return `${n} ${n === 1 ? "game" : "games"} with a PA`;
}

/**
 * Games with no plate appearance for this player, by date and opponent, in
 * tournament and day order. Printed reports use it as a compact key because a
 * printed dot cannot be tapped.
 */
export function noPaGames(view) {
  const out = [];
  for (const t of view?.dots ?? []) {
    for (const d of t.days) {
      for (const g of d.games) {
        if (g.status !== "nopa") continue;
        out.push({
          tournament: t.name,
          text: `${g.dayLabel ?? "Game"}${g.opponent ? `, vs ${g.opponent}` : ""}`,
        });
      }
    }
  }
  return out;
}
