/**
 * Who may be taken off a tournament's attendance list.
 *
 * A batting order and recorded at-bats refer to players, not to attendance, so
 * removing someone from the tournament roster used to leave them in lineups
 * and tracked games with nothing saying so. Attendance changes never edit a
 * batting order. Instead, removal is refused while the player is in use, and
 * the refusal says where: a recorded at-bat means they stay (use Substitute in
 * the tracker), a saved but untracked batting order means "open that lineup
 * and take them out first".
 *
 * One shared check, used by both ways of removing someone (the roster sheet
 * and the remove button) so they cannot disagree. It only reads.
 */

const clean = (ids) => [...new Set((ids ?? []).filter(Boolean))];

/**
 * @returns {Promise<{ blockers: Array, error?: string }>}
 *   blockers: [{ player_id, kind: "has_at_bats" | "in_lineup", games: [{ id, opponent, game_date, tournament_id }] }]
 */
export async function attendanceBlockers(supabase, tournamentId, playerIds) {
  const ids = clean(playerIds);
  if (!ids.length) return { blockers: [] };

  const { data: games, error: gErr } = await supabase
    .from("games")
    .select("id, opponent_name, game_date, tournament_id")
    .eq("tournament_id", tournamentId);
  if (gErr) return { blockers: [], error: gErr.message };
  const gameList = games ?? [];
  if (!gameList.length) return { blockers: [] };
  const byId = new Map(gameList.map((g) => [g.id, g]));
  const gameIds = gameList.map((g) => g.id);

  const [slots, pas] = await Promise.all([
    supabase.from("game_lineup_slots").select("game_id, player_id").in("game_id", gameIds).in("player_id", ids),
    // A voided at-bat is a deleted one: it does not keep anyone attached.
    supabase.from("plate_appearances").select("game_id, player_id").in("game_id", gameIds).in("player_id", ids).is("voided_at", null),
  ]);
  if (slots.error || pas.error) return { blockers: [], error: (slots.error ?? pas.error).message };

  const ref = (gameId) => {
    const g = byId.get(gameId);
    return { id: g.id, opponent: g.opponent_name ?? null, game_date: g.game_date ?? null, tournament_id: g.tournament_id };
  };
  const collect = (rows) => {
    const m = new Map();
    for (const row of rows ?? []) {
      if (!byId.has(row.game_id)) continue;
      const list = m.get(row.player_id) ?? new Map();
      list.set(row.game_id, ref(row.game_id));
      m.set(row.player_id, list);
    }
    return m;
  };
  const withBats = collect(pas.data);
  const inOrder = collect(slots.data);

  const blockers = [];
  for (const id of ids) {
    if (withBats.has(id)) blockers.push({ player_id: id, kind: "has_at_bats", games: [...withBats.get(id).values()] });
    else if (inOrder.has(id)) blockers.push({ player_id: id, kind: "in_lineup", games: [...inOrder.get(id).values()] });
  }
  return { blockers };
}

const gameName = (g) => (g.opponent ? `Game vs ${g.opponent}` : "a game");

/** The sentence a coach reads. Names the first blocked player and what to do. */
export function blockerMessage(blockers, names = {}) {
  if (!blockers?.length) return "";
  const first = blockers[0];
  const who = names[first.player_id] ?? "That player";
  const g = first.games[0];
  const more = blockers.length > 1 ? ` ${blockers.length - 1} more ${blockers.length - 1 === 1 ? "player is" : "players are"} in the same situation.` : "";
  if (first.kind === "has_at_bats") {
    return `${who} has recorded at-bats in ${gameName(g)}, so they stay on this tournament roster. To change who bats, use Substitute in the tracker.${more}`;
  }
  return `${who} is in the batting order for ${gameName(g)}. Open that lineup and take them out first, then remove them here.${more}`;
}
