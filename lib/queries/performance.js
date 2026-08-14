import { createClient } from "../supabase/server";

/**
 * Reads for the Performance landing page.
 *
 * Everything here is a read of existing tables. No new statistic is computed
 * and no aggregate view is queried — the landing page is a guided workflow,
 * not a dashboard.
 *
 * The QAB feature gate stays in RLS. With the feature disabled, lineup and
 * plate-appearance reads return zero rows, which is why the page checks
 * ctx.features before calling this at all rather than inferring "disabled"
 * from emptiness.
 */

/**
 * The tournament a coach is most likely working on next.
 *
 * Deliberately a tournament, not a game. Northgate has two games on the same
 * date with start_time null on both, and nothing in the schema orders them —
 * picking one would mean showing "Continue tracking" or "Set batting order"
 * on a coin flip. The coach chooses the game they are actually at.
 */
export async function getPerformanceOverview() {
  const supabase = createClient();

  const today = new Date().toISOString().slice(0, 10);

  const { data: tournaments, error: tErr } = await supabase
    .from("tournaments")
    .select(
      `id, name, start_date, end_date, decision,
       provider:tournament_providers ( name ),
       facility:facilities ( name, city, state )`
    )
    .order("start_date");

  if (tErr) throw new Error(`Could not load tournaments: ${tErr.message}`);

  const committed = (tournaments ?? []).filter((t) => t.decision === "Committed");

  // Upcoming first; otherwise the most recent, so a coach entering results
  // after a weekend still lands somewhere useful.
  const upcoming = committed.filter((t) => (t.end_date ?? t.start_date) >= today);
  const tournament = upcoming[0] ?? committed[committed.length - 1] ?? null;

  if (!tournament) {
    return { tournament: null, participantCount: 0, games: [] };
  }

  const { count: participantCount } = await supabase
    .from("tournament_participants")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournament.id);

  const { data: games, error: gErr } = await supabase
    .from("games")
    .select("id, game_date, start_time, opponent_name, game_type")
    .eq("tournament_id", tournament.id)
    // Date only. start_time is null on almost every game, so it cannot break
    // a same-day tie; id is a deterministic tiebreak for rendering only and
    // must never be presented as chronology.
    .order("game_date")
    .order("id");

  if (gErr) throw new Error(`Could not load games: ${gErr.message}`);

  const gameIds = (games ?? []).map((g) => g.id);

  let lineupByGame = new Map();
  let paByGame = new Map();

  if (gameIds.length > 0) {
    // Two batched reads rather than a pair per row.
    const { data: slots } = await supabase
      .from("game_lineup_slots")
      .select("game_id")
      .in("game_id", gameIds);

    for (const s of slots ?? []) {
      lineupByGame.set(s.game_id, (lineupByGame.get(s.game_id) ?? 0) + 1);
    }

    const { data: pas } = await supabase
      .from("plate_appearances")
      .select("game_id, voided_at")
      .in("game_id", gameIds);

    for (const p of pas ?? []) {
      if (p.voided_at) continue;
      paByGame.set(p.game_id, (paByGame.get(p.game_id) ?? 0) + 1);
    }
  }

  return {
    tournament,
    participantCount: participantCount ?? 0,
    games: (games ?? []).map((g) => ({
      ...g,
      batters: lineupByGame.get(g.id) ?? 0,
      plateAppearances: paByGame.get(g.id) ?? 0,
    })),
  };
}
