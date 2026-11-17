import { createClient } from "../../supabase/server";
import { getSeasonPerformance } from "../performance";
import { reportIdentity, reportReasons } from "./qab-performance";
import {
  playerGameCells,
  qabGames,
  qabDayGroups,
  qabExtremes,
  previousTournament,
  compareNamesAlphabetical,
} from "../../qab-rules";
import { isGameWithinTournament, formatDateRange, formatDayLabel } from "../../schedule-rules";

/**
 * Tournament scope of the coach-facing QAB Performance report (RPT-04).
 *
 * The same derivation as Season — getSeasonPerformance — narrowed to the games
 * linked to one tournament. Nothing is re-derived here: every QAB, PA and
 * percentage is read from the derivation, so this reconciles to Performance
 * exactly as the Season report does.
 *
 * COACH-FACING. Decided 2026-11: this report may show each player's
 * game-by-game QAB/PA. That decision is specific to this coach document and
 * sets NO precedent for any parent-facing report, which needs its own query
 * and its own allowlist. As in Season, player rows carry no playerId, so this
 * payload cannot be filtered down to one player.
 *
 * Deliberately absent: playerId, lineups and batting orders, plate-appearance
 * ids.
 *
 * SCORES AND A RECORD ARE ALLOWED HERE (2026-11, supersedes this payload's
 * earlier "no scores, no wins-vs-losses aggregate" rule; the Season payload
 * keeps that rule unchanged). The Tournament Summary shows the tournament
 * record, runs scored and allowed, and each game's final score.
 *
 * TWO SCOPES, KEPT APART ON PURPOSE:
 *   - Every QAB-derived figure (tournament QAB%, QAB/PA, day-by-day, highest and
 *     lowest QAB% game, reason mix, player totals, the previous-tournament
 *     comparison) comes from TRACKED games only, i.e. games with plate
 *     appearances. An untracked game never reaches one.
 *   - Record, runs scored and runs allowed use EVERY game linked to the
 *     tournament that has a recorded result, tracked or not.
 * `tournamentSummary.scope` says how many of each, so the report can state the
 * difference when there is one.
 */

/**
 * Tournaments in this season with at least one tracked (non-voided) plate
 * appearance, with their start dates (null if none). Shared by the screen-only
 * selector and by the previous-tournament comparison, so "tracked" means the
 * same thing in both.
 */
async function trackedTournamentsWithDates(seasonId) {
  const supabase = createClient();

  const { data: pas, error } = await supabase
    .from("plate_appearances")
    .select("game:games ( tournament_id )")
    .eq("season_id", seasonId)
    .is("voided_at", null);
  if (error) throw new Error(`Could not load tracked tournaments: ${error.message}`);

  const ids = [...new Set((pas ?? []).map((r) => r.game?.tournament_id).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data: rows, error: tErr } = await supabase
    .from("tournaments")
    .select("id, name, start_date, end_date")
    .eq("season_id", seasonId)
    .in("id", ids);
  if (tErr) throw new Error(`Could not load tracked tournaments: ${tErr.message}`);

  return (rows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    dates: formatDateRange(t.start_date, t.end_date),
    startDate: t.start_date ?? null,
  }));
}

/**
 * Tournaments in this season with at least one tracked (non-voided) plate
 * appearance, most recent first. Drives the screen-only selector; never
 * printed. Membership is the game's tournament link, as everywhere in RPT-04.
 */
export async function listTrackedTournaments(seasonId) {
  if (!seasonId) throw new Error("listTrackedTournaments requires a seasonId.");
  return (await trackedTournamentsWithDates(seasonId))
    .sort(
      (a, b) =>
        (b.startDate ?? "").localeCompare(a.startDate ?? "") || (a.name ?? "").localeCompare(b.name ?? "")
    )
    .map(({ startDate, ...t }) => t);
}

/**
 * The Tournament report payload, or null when the tournament is not in this
 * season (a stale or foreign id is "not found", never another team's data —
 * RLS is the boundary, this is the scope).
 */
export async function qabTournamentReport(seasonId, tournamentId) {
  if (!seasonId) throw new Error("qabTournamentReport requires a seasonId.");
  if (!tournamentId) return null;

  const supabase = createClient();
  const { data: t } = await supabase
    .from("tournaments")
    .select("id, name, start_date, end_date, season_id")
    .eq("id", tournamentId)
    .eq("season_id", seasonId)
    .maybeSingle();
  if (!t) return null;

  const scoped = await getSeasonPerformance(seasonId, { tournamentId });
  const identity = await reportIdentity(seasonId);
  const { reasons, reasonsCited } = reportReasons(scoped);

  // Chronological, exactly as the derivation ordered them; numbered G1, G2…
  // by that order, and the same numbers head the game-by-game columns.
  const games = scoped.games ?? [];

  /**
   * A linked game dated outside the tournament stays in scope (the link is
   * membership). The coach is told, once, in the screen-only notes; the printed
   * document is not annotated.
   */
  const outside = games
    .map((g, i) => ({ g, n: i + 1 }))
    .filter(({ g }) => g.gameDate && !isGameWithinTournament(g.gameDate, t.start_date, t.end_date));

  const players = (scoped.players ?? [])
    .map((p) => {
      const cells = playerGameCells(games, p.playerId);
      const counts = qabGames(cells);
      return {
        name: p.name,
        games: counts.batted,
        qab: p.qab,
        pa: p.pa,
        qabPct: p.qabPct,
        qabGames: counts.withQab,
        byGame: cells,
      };
    })
    // Alphabetical by the name as printed. Deliberately not a QAB% order: the
    // report never ranks players.
    .sort((a, b) => compareNamesAlphabetical(a.name, b.name));

  const tournamentSummary = await buildTournamentSummary({ seasonId, tournament: t, scoped, games });
  const scoreless = tournamentSummary._scoreless;
  delete tournamentSummary._scoreless;

  return {
    generatedAt: new Date().toISOString(),

    organization: {
      name: identity?.team?.organization?.name ?? null,
      logoUrl: identity?.team?.organization?.logo_url ?? null,
    },
    team: { name: identity?.team?.name ?? null },
    season: { name: identity?.name ?? null },
    tournament: {
      name: t.name,
      dates: formatDateRange(t.start_date, t.end_date),
    },

    summary: {
      qabPct: scoped.team.qabPct,
      qab: scoped.team.qab,
      pa: scoped.team.pa,
      games: scoped.team.games,
    },

    games: games.map((g, i) => ({
      id: g.gameId,
      number: i + 1,
      day: formatDayLabel(g.gameDate),
      time: g.startTime ?? null,
      opponent: g.opponent,
      result: g.result ?? null,
      runsFor: g.runsFor ?? null,
      runsAgainst: g.runsAgainst ?? null,
      qab: g.qab,
      pa: g.pa,
      qabPct: g.qabPct,
    })),

    tournamentSummary,

    reasons,
    reasonsCited,
    players,

    // Coach-facing only. Rendered in the screen-only toolbar, never printed.
    notes: [
      ...(scoreless > 0
        ? [
            {
              action: false,
              title: "Game score to review",
              message:
                `${scoreless} ${scoreless === 1 ? "game has" : "games have"} a result but no recorded score, ` +
                "so the runs scored and allowed leave " +
                `${scoreless === 1 ? "it" : "them"} out. Add the score in Tournaments to include ` +
                `${scoreless === 1 ? "it" : "them"}.`,
            },
          ]
        : []),
      ...(outside.length > 0
        ? [
            {
              action: false,
              title: "Game date to review",
              message:
                `${outside.map(({ g, n }) => `G${n} (${formatDayLabel(g.gameDate)})`).join(", ")} ` +
                `${outside.length === 1 ? "is" : "are"} linked to this tournament but dated outside ` +
                `${formatDateRange(t.start_date, t.end_date) ?? "its dates"}. ` +
                `${outside.length === 1 ? "It is" : "They are"} included here because of that link. ` +
                "Review the game date in Tournaments if it isn't right.",
            },
          ]
        : []),
    ],
  };
}

/**
 * The Tournament Summary block (2026-11). See the header for the two scopes.
 *
 * `scoped` and `games` are the TRACKED games from the shared derivation.
 * Record comes from that derivation's own tournament record (every linked
 * game with a result); runs come from one small read of the same games.
 * Highest and lowest QAB% game are returned as game NUMBERS (G-numbers), so
 * the document reads the rest from the games list.
 */
async function buildTournamentSummary({ seasonId, tournament, scoped, games }) {
  const empty = { record: null, runs: null, scope: null, previous: null, days: null, highest: null, lowest: null, _scoreless: 0 };
  const trackedIds = new Set(games.map((g) => g.gameId));
  const supabase = createClient();

  // Every game linked to this tournament, tracked or not.
  const { data: linked, error } = await supabase
    .from("games")
    .select("id, result, runs_for, runs_against")
    .eq("season_id", seasonId)
    .eq("tournament_id", tournament.id);
  if (error) throw new Error(`Could not load tournament results: ${error.message}`);
  const resultGames = (linked ?? []).filter((g) => g.result === "W" || g.result === "L" || g.result === "T");
  const scored = resultGames.filter((g) => Number.isFinite(g.runs_for) && Number.isFinite(g.runs_against));

  const rec = scoped.record;
  const hasTracked = games.length > 0;
  const result = {
    record: rec && rec.played > 0 ? { w: rec.w, l: rec.l, t: rec.t, played: rec.played } : null,
    runs:
      scored.length > 0
        ? {
            scored: scored.reduce((n, g) => n + g.runs_for, 0),
            allowed: scored.reduce((n, g) => n + g.runs_against, 0),
            games: scored.length,
          }
        : null,
    scope: {
      resultGames: rec?.played ?? 0,
      trackedGames: games.length,
      untrackedResultGames: resultGames.filter((g) => !trackedIds.has(g.id)).length,
    },
    _scoreless: resultGames.length - scored.length,
  };
  if (!hasTracked) return { ...empty, ...result };

  const days = qabDayGroups(games);
  const ex = qabExtremes(games);
  const numberOf = (g) => (g ? games.indexOf(g) + 1 : null);

  // Previous TRACKED tournament: the closest earlier one with plate appearances.
  const tracked = await trackedTournamentsWithDates(seasonId);
  const prev = previousTournament(tracked, { id: tournament.id, startDate: tournament.start_date ?? null });
  let previous = null;
  if (prev) {
    const p = (await getSeasonPerformance(seasonId, { tournamentId: prev.id })).team;
    if (p && p.pa > 0) previous = { name: prev.name, qab: p.qab, pa: p.pa, qabPct: p.qabPct };
  }

  return {
    ...result,
    previous,
    days: days ? days.map((d) => ({ ...d, label: formatDayLabel(d.date) })) : null,
    highest: ex ? numberOf(ex.highest) : null,
    lowest: ex ? numberOf(ex.lowest) : null,
  };
}
