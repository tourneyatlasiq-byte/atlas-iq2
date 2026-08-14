import { createClient } from "../supabase/server";
import {
  tallyPlateAppearances,
  qabPercent,
  meetsMinimumPA,
  reasonLabel,
  REASON_KEYS,
} from "../qab-rules";

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

/**
 * Season aggregates for the Performance page.
 *
 * SCALING BOUNDARY — deliberate, and here is where it moves.
 * This retrieves live plate appearances directly and aggregates them in this
 * module. That is intentional at current volume: it means the page and the
 * live tracker compute quality at-bats through the same helpers in
 * lib/qab-rules.js and cannot disagree, and it costs one round trip instead of
 * four (the qab_* views carry the maths but not player, game or tournament
 * names, and views expose no foreign-key metadata for PostgREST to embed).
 *
 * When a season's raw rows make this retrieval inefficient, or when per-game
 * analytics such as sparklines and consistency arrive, move aggregation to
 * purpose-built views — the previously discussed qab_player_game among them.
 * Those views do not exist yet and are not needed for this version.
 *
 * is_qab remains authoritative and comes from the database, where it is a
 * generated column. QAB is never inferred from how many reasons were cited:
 * one plate appearance is at most one quality at-bat, however many reasons
 * describe it.
 */
export async function getSeasonPerformance() {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("plate_appearances")
    .select(
      `id, player_id, game_id, is_qab, qab_reasons, batting_order,
       player:players ( id, full_name ),
       game:games ( id, game_date, tournament_id,
                    tournament:tournaments ( id, name, start_date ) )`
    )
    .is("voided_at", null);

  if (error) throw new Error(`Could not load season performance: ${error.message}`);

  const rows = data ?? [];

  // Team totals. tallyPlateAppearances() filters voided rows too, so this
  // stays correct even if the query above is ever relaxed.
  const team = tallyPlateAppearances(rows);

  const games = new Set();
  const players = new Map();
  const tournaments = new Map();
  const reasonCounts = new Map();

  for (const r of rows) {
    if (r.game_id) games.add(r.game_id);

    // Per player.
    const p = players.get(r.player_id) ?? {
      playerId: r.player_id,
      name: r.player?.full_name ?? "Unknown player",
      pa: 0,
      qab: 0,
    };
    p.pa += 1;
    if (r.is_qab) p.qab += 1;
    players.set(r.player_id, p);

    // Per tournament.
    const t = r.game?.tournament;
    if (t?.id) {
      const agg = tournaments.get(t.id) ?? {
        tournamentId: t.id,
        name: t.name,
        startDate: t.start_date,
        pa: 0,
        qab: 0,
        gameIds: new Set(),
        playerIds: new Set(),
      };
      agg.pa += 1;
      if (r.is_qab) agg.qab += 1;
      if (r.game_id) agg.gameIds.add(r.game_id);
      agg.playerIds.add(r.player_id);
      tournaments.set(t.id, agg);
    }

    // Reasons cited. Counted per occurrence, which is why this total can and
    // does exceed the quality-at-bat count — one plate appearance may cite
    // several. These two numbers are always presented separately.
    for (const key of r.qab_reasons ?? []) {
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }

  const playerRows = [...players.values()]
    .map((p) => ({ ...p, qabPct: qabPercent(p.qab, p.pa), earlyData: !meetsMinimumPA(p.pa) }))
    // Plate appearances, not percentage. Ordering by percentage would rank,
    // and nothing here ranks.
    .sort((a, b) => b.pa - a.pa || b.qab - a.qab || a.name.localeCompare(b.name));

  const tournamentRows = [...tournaments.values()]
    .map((t) => ({
      tournamentId: t.tournamentId,
      name: t.name,
      startDate: t.startDate,
      pa: t.pa,
      qab: t.qab,
      qabPct: qabPercent(t.qab, t.pa),
      games: t.gameIds.size,
      players: t.playerIds.size,
    }))
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));

  // Every reason in the approved vocabulary, so "view all" can show the ones
  // never recorded without the caller re-deriving the list.
  const reasons = REASON_KEYS.map((key) => ({
    key,
    label: reasonLabel(key),
    count: reasonCounts.get(key) ?? 0,
  }));

  return {
    team: {
      pa: team.pa,
      qab: team.qab,
      qabPct: team.qabPct,
      games: games.size,
      players: players.size,
      tournaments: tournaments.size,
    },
    reasons,
    reasonsCited: [...reasonCounts.values()].reduce((a, b) => a + b, 0),
    players: playerRows,
    tournaments: tournamentRows,
  };
}
