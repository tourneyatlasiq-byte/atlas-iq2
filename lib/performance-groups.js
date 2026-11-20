/**
 * Active players first, inactive players grouped beneath them (2026-11).
 *
 * A player who is inactive this season keeps every at-bat, total and saved
 * batting order. This only changes where they are listed. A player with no
 * season-roster row (a pickup) is not "inactive": they stay in the main list.
 * Order inside each group is whatever the caller already sorted.
 */
export function splitByActivity(sortedPlayers) {
  const active = [], inactive = [];
  for (const p of sortedPlayers ?? []) (p.isActive === false ? inactive : active).push(p);
  return { active, inactive };
}

/**
 * player_id -> false only when the player has rows for THIS team and none are
 * active. Rows for other teams are ignored: a player inactive here but active
 * elsewhere is inactive here. teamId null means the caller has already scoped.
 */
export function activityByPlayer(seasonRows, teamId = null) {
  const m = new Map();
  for (const r of seasonRows ?? []) {
    if (teamId && r.team_id !== teamId) continue;
    m.set(r.player_id, (m.get(r.player_id) ?? false) || r.is_active !== false);
  }
  return m;
}
