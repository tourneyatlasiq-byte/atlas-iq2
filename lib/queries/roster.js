import { createClient } from "../supabase/server";

/**
 * Season roster: team_season_players joined to players.
 *
 * Scoped by season_id — a season belongs to exactly one team, so this is
 * also team scoping. The legacy `roster` table is never read.
 */
export async function listSeasonRoster(seasonId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("team_season_players")
    .select(
      `id, jersey_number, jersey_size, pants_size, position, joined_at,
       player:players ( id, full_name, person_type, grad_year, date_of_birth,
                        player_email, parent_email, parent_phone )`
    )
    .eq("season_id", seasonId)
    .order("jersey_number", { nullsFirst: false });

  if (error) throw new Error(`Could not load the roster: ${error.message}`);
  return data ?? [];
}
