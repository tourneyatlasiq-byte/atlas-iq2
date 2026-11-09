import { createClient } from "../../supabase/server";
import { getSeasonPerformance } from "../performance";
import { reportIdentity, reportReasons } from "./qab-performance";
import { playerGameCells, qabGames } from "../../qab-rules";
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
 * ids, scores, any wins-vs-losses aggregate.
 */

/**
 * Tournaments in this season with at least one tracked (non-voided) plate
 * appearance, most recent first. Drives the screen-only selector; never
 * printed. Membership is the game's tournament link, as everywhere in RPT-04.
 */
export async function listTrackedTournaments(seasonId) {
  if (!seasonId) throw new Error("listTrackedTournaments requires a seasonId.");
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

  return (rows ?? [])
    .map((t) => ({
      id: t.id,
      name: t.name,
      dates: formatDateRange(t.start_date, t.end_date),
      startDate: t.start_date ?? null,
    }))
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
    .sort(
      (a, b) =>
        (b.qabPct ?? -1) - (a.qabPct ?? -1) ||
        b.pa - a.pa ||
        a.name.localeCompare(b.name)
    );

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
      qab: g.qab,
      pa: g.pa,
      qabPct: g.qabPct,
    })),

    reasons,
    reasonsCited,
    players,

    // Coach-facing only. Rendered in the screen-only toolbar, never printed.
    notes:
      outside.length > 0
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
        : [],
  };
}
