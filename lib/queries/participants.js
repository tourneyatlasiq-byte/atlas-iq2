import { createClient } from "../supabase/server";

/**
 * Event roster — who actually dressed for a tournament.
 *
 * Distinct from the season roster, which is who belongs to the team this year.
 * An empty result means "not recorded yet", never "everyone attended".
 */

const PARTICIPANT_SELECT = `
  id, tournament_id, player_id, participation, jersey_number, positions, notes, created_at,
  player:players ( id, full_name, grad_year, person_type, date_of_birth )
`;

/** Participants for every tournament in the season, keyed by tournament. */
export async function participantsBySeason(seasonId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("tournament_participants")
    .select(PARTICIPANT_SELECT)
    .eq("season_id", seasonId);

  if (error) throw new Error(error.message);

  const byTournament = new Map();
  for (const p of data ?? []) {
    byTournament.set(p.tournament_id, [...(byTournament.get(p.tournament_id) ?? []), p]);
  }

  // Jersey first, then name — how a coach reads a line-up.
  for (const [, rows] of byTournament) {
    rows.sort((a, b) => {
      const an = a.jersey_number ?? 999;
      const bn = b.jersey_number ?? 999;
      if (an !== bn) return an - bn;
      return (a.player?.full_name ?? "").localeCompare(b.player?.full_name ?? "");
    });
  }

  return byTournament;
}

/**
 * Players who picked up with this team during the season, with the events they
 * played. One row per person, not per appearance.
 */
export async function pickupsForSeason(seasonId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("tournament_participants")
    .select(`
      player_id, positions, jersey_number,
      player:players ( id, full_name, grad_year, person_type ),
      tournament:tournaments ( id, name, start_date, season_id )
    `)
    .eq("season_id", seasonId)
    .eq("participation", "pickup");

  if (error) throw new Error(error.message);

  const byPlayer = new Map();
  for (const row of data ?? []) {
    if (!row.player) continue;
    const existing = byPlayer.get(row.player_id) ?? {
      player_id: row.player_id,
      player: row.player,
      positions: row.positions ?? [],
      tournaments: [],
    };
    if (row.tournament) existing.tournaments.push(row.tournament);
    if (!existing.positions?.length && row.positions?.length) existing.positions = row.positions;
    byPlayer.set(row.player_id, existing);
  }

  const rows = [...byPlayer.values()];
  for (const r of rows) {
    r.tournaments.sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
  }
  rows.sort((a, b) => (a.player.full_name ?? "").localeCompare(b.player.full_name ?? ""));
  return rows;
}

/**
 * Every event a player has taken part in, across all seasons they share with
 * this organization. Used in the player drawer.
 */
export async function participationHistory(playerId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("tournament_participants")
    .select(`
      id, participation, jersey_number, season_id,
      tournament:tournaments ( id, name, start_date, season_id )
    `)
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Organization players available to add as a pickup, with how often they have
 * played with this team already.
 *
 * Deliberately searches ALL organization players rather than this season's
 * roster — reusing a returning pickup is the point.
 */
export async function pickupCandidates(organizationId, seasonId) {
  const supabase = createClient();

  const [{ data: players }, { data: assigned }, { data: history }] = await Promise.all([
    supabase
      .from("players")
      .select("id, full_name, grad_year, person_type")
      .eq("organization_id", organizationId)
      .order("full_name"),
    supabase.from("team_season_players").select("player_id").eq("season_id", seasonId),
    supabase.from("tournament_participants").select("player_id, participation"),
  ]);

  const onRoster = new Set((assigned ?? []).map((r) => r.player_id));

  const counts = new Map();
  for (const h of history ?? []) {
    counts.set(h.player_id, (counts.get(h.player_id) ?? 0) + 1);
  }

  return (players ?? []).map((p) => ({
    ...p,
    // The database refuses a roster player as a pickup, so the interface says
    // so before the attempt rather than surfacing an error afterwards.
    onSeasonRoster: onRoster.has(p.id),
    eventsWithUs: counts.get(p.id) ?? 0,
  }));
}
