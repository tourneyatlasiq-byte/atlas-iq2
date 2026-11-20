/**
 * What the tournament attendance sheet lists, preselects and submits.
 *
 * The sheet used to show only active season-roster players and submit only
 * those, so a current attendee who had since gone inactive (or left the season
 * roster) disappeared from the tournament on the next Save, even when the coach
 * only changed something else. Now anyone already attending stays visible and
 * selected, and is only removed when the coach unchecks them. Players who are
 * not attending start unselected: an empty roster still means "not recorded".
 */

export function rosterSheetModel(participants, seasonRoster) {
  const rows = seasonRoster ?? [];
  const isPlayer = (r) => r.player?.person_type === "player" && r.player?.id;
  const active = rows.filter((r) => r.is_active && isPlayer(r));
  const activeIds = new Set(active.map((r) => r.player.id));
  const bySeason = new Map(rows.filter(isPlayer).map((r) => [r.player.id, r]));

  const attending = (participants ?? []).filter((p) => p.participation === "roster");
  const attendingById = new Map(attending.map((p) => [p.player_id, p]));
  const outside = attending
    .filter((p) => !activeIds.has(p.player_id))
    .map((p) => {
      const season = bySeason.get(p.player_id);
      return {
        player_id: p.player_id,
        name: season?.player?.full_name ?? p.player?.full_name ?? "Unnamed",
        note: season ? "Inactive" : "Not on this season's roster",
        jersey_number: p.jersey_number ?? season?.jersey_number ?? null,
        positions: p.positions ?? season?.positions ?? [],
        _order: season ? rows.indexOf(season) : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((x, y) => x._order - y._order)
    .map(({ _order, ...o }) => o);

  const initialSelected = new Set(attendingById.keys());
  return {
    active,
    outside,
    initialSelected,
    // "Select all active players" adds the active ones. Attendees outside the
    // active list stay exactly as they are; they are never selected or cleared by it.
    selectAllActive: (current) => {
      const next = new Set(current);
      for (const r of active) next.add(r.player.id);
      return next;
    },
  };
}

/** The participant entries the server receives, one "id|roster|jersey|positions" string per selected person. */
export function submissionEntries({ selected, model, participants }) {
  const existing = new Map((participants ?? []).filter((p) => p.participation === "roster").map((p) => [p.player_id, p]));
  const out = [];
  const line = (id, jersey, positions) => `${id}|roster|${jersey ?? ""}|${(positions ?? []).join(",")}`;
  for (const r of model.active) {
    if (!selected.has(r.player.id)) continue;
    const prior = existing.get(r.player.id);
    // Event values default from the season roster but are stored separately.
    out.push(line(r.player.id, prior?.jersey_number ?? r.jersey_number, prior?.positions ?? r.positions));
  }
  for (const o of model.outside) {
    if (!selected.has(o.player_id)) continue;
    const prior = existing.get(o.player_id);
    out.push(line(o.player_id, prior?.jersey_number ?? o.jersey_number, prior?.positions ?? o.positions));
  }
  return out;
}
