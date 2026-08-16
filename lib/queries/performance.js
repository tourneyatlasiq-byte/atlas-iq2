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
    .select("id, game_date, start_time, opponent_name, game_type, qab_completed_at")
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
      // Completion is an explicit coach action, never derived from the counts
      // above or from a recorded score.
      completed: Boolean(g.qab_completed_at),
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
       game:games ( id, game_date, opponent_name, game_type, result,
                    runs_for, runs_against, qab_completed_at, tournament_id,
                    tournament:tournaments ( id, name, start_date ) )`
    )
    .is("voided_at", null);

  if (error) throw new Error(`Could not load season performance: ${error.message}`);

  const rows = data ?? [];

  /**
   * Season record.
   *
   * Read from games.result, which the database derives from the recorded score
   * — never inferred from QAB tracking, completion state or plate appearance
   * count. Those are independent facts.
   *
   * A separate read on purpose: a game can carry a result with no plate
   * appearances at all, so it would be invisible to the aggregation above.
   * Scoped by RLS like every other query here.
   */
  const { data: resultRows } = await supabase.from("games").select("result");

  const allGames = resultRows ?? [];
  const w = allGames.filter((g) => g.result === "W").length;
  const l = allGames.filter((g) => g.result === "L").length;
  const t = allGames.filter((g) => g.result === "T").length;
  const played = w + l + t;

  const record = {
    w,
    l,
    t,
    played,
    total: allGames.length,
    // Whole percent, matching how a coach reads a record.
    winPct: played > 0 ? Math.round((w / played) * 100) : null,
  };

  // Team totals. tallyPlateAppearances() filters voided rows too, so this
  // stays correct even if the query above is ever relaxed.
  const team = tallyPlateAppearances(rows);

  const games = new Set();
  const players = new Map();
  const gameMap = new Map();
  // Counted here rather than derived from gameRows, which carry the tournament
  // name for display but not its id.
  const tournamentIds = new Set();
  const playerReasons = new Map();
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

    // Per player, per reason. Occurrences, never a quality-at-bat count.
    const pr = playerReasons.get(r.player_id) ?? new Map();
    for (const key of r.qab_reasons ?? []) {
      pr.set(key, (pr.get(key) ?? 0) + 1);
    }
    playerReasons.set(r.player_id, pr);

    // Per game, and within a game per batting-order position.
    const g = r.game;
    if (g?.tournament_id) tournamentIds.add(g.tournament_id);
    if (g?.id) {
      const agg = gameMap.get(g.id) ?? {
        gameId: g.id,
        opponent: g.opponent_name ?? "Opponent",
        gameDate: g.game_date,
        gameType: g.game_type,
        tournament: g.tournament?.name ?? null,
        // Completion is an explicit coach action read straight off the game.
        // It is never derived from the score, the result or the PA count.
        completed: Boolean(g.qab_completed_at),
        result: g.result,
        runsFor: g.runs_for,
        runsAgainst: g.runs_against,
        pa: 0,
        qab: 0,
        slots: new Map(),
      };
      agg.pa += 1;
      if (r.is_qab) agg.qab += 1;

      // batting_order is the immutable snapshot taken when the plate
      // appearance was recorded, not the current lineup — so this stays
      // accurate after a lineup is edited. Null means the position is
      // genuinely unknown; it is never coerced to zero or invented.
      //
      // Keyed by position AND player, never by position alone. A substitution
      // puts two players in the same slot in one game: keying on the position
      // merged their at-bats into a single row labelled with whichever player
      // happened to be read first, so a starter's at-bats were reported as the
      // substitute's. Identity is player_id; the position is context.
      const battingOrder = r.batting_order ?? null;
      const slotKey = `${battingOrder ?? "none"}:${r.player_id}`;
      const slot = agg.slots.get(slotKey) ?? {
        battingOrder,
        playerId: r.player_id,
        name: r.player?.full_name ?? "Unknown player",
        pa: 0,
        qab: 0,
      };
      slot.pa += 1;
      if (r.is_qab) slot.qab += 1;
      agg.slots.set(slotKey, slot);

      gameMap.set(g.id, agg);
    }

    // Reasons cited, team-wide.
    for (const key of r.qab_reasons ?? []) {
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }

  const playerRows = [...players.values()]
    .map((p) => ({
      ...p,
      qabPct: qabPercent(p.qab, p.pa),
      earlyData: !meetsMinimumPA(p.pa),
      // Only what this player actually recorded. Zero-count categories are
      // not padded in, and this list is never totalled and called QAB.
      reasons: [...(playerReasons.get(p.playerId) ?? new Map())]
        .map(([key, count]) => ({ key, label: reasonLabel(key), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    }))
    // Default order only; the season view offers a sort control and applies
    // its own. QAB% leads because across several games it is the figure a
    // coach is actually reading, and the Early flag below the PA minimum is
    // what keeps a 100% on three at-bats from being mistaken for form.
    .sort(
      (a, b) =>
        (b.qabPct ?? -1) - (a.qabPct ?? -1) ||
        b.pa - a.pa ||
        a.name.localeCompare(b.name)
    );

  const gameRows = [...gameMap.values()]
    .map((g) => ({
      gameId: g.gameId,
      opponent: g.opponent,
      gameDate: g.gameDate,
      gameType: g.gameType,
      tournament: g.tournament,
      completed: g.completed,
      result: g.result,
      runsFor: g.runsFor,
      runsAgainst: g.runsAgainst,
      hasScore: g.runsFor != null && g.runsAgainst != null,
      pa: g.pa,
      qab: g.qab,
      qabPct: qabPercent(g.qab, g.pa),
      // Batting order is the report. Never sorted by percentage; nulls last
      // because an unknown position has no place in the sequence.
      // Two players can now share a position, so name breaks the tie and the
      // order is stable rather than dependent on which row was read first.
      lineup: [...g.slots.values()].sort((a, b) => {
        if (a.battingOrder == null && b.battingOrder == null) {
          return a.name.localeCompare(b.name);
        }
        if (a.battingOrder == null) return 1;
        if (b.battingOrder == null) return -1;
        return a.battingOrder - b.battingOrder || a.name.localeCompare(b.name);
      }).map((s2) => ({ ...s2, qabPct: qabPercent(s2.qab, s2.pa) })),
    }))
    // Chronological, not by performance.
    .sort((a, b) => (a.gameDate ?? "").localeCompare(b.gameDate ?? ""));

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
      tournaments: tournamentIds.size,
    },
    reasons,
    reasonsCited: [...reasonCounts.values()].reduce((a, b) => a + b, 0),
    record,
    players: playerRows,
    games: gameRows,
    gamesCompleted: gameRows.filter((g) => g.completed).length,
  };
}
