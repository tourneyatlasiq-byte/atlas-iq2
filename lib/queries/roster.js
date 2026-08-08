import { createClient } from "../supabase/server";

export const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "UTIL", "DP", "FLEX"];
export const SIZES = ["YS", "YM", "YL", "AS", "AM", "AL", "AXL"];
export const PERSON_TYPES = ["player", "coach", "manager", "other"];
export const THROWS = ["R", "L"];
export const BATS = ["R", "L", "S"];

/**
 * Season roster: team_season_players joined to the persistent player.
 *
 * Scoped by season_id, which is also team scoping since a season belongs to
 * exactly one team. The legacy `roster` table is never read.
 */
export async function listSeasonRoster(seasonId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("team_season_players")
    .select(
      `id, jersey_number, jersey_size, pants_size, position, positions, is_active, joined_at,
       player:players ( id, full_name, person_type, other_role_label, grad_year, date_of_birth,
                        throws, bats, player_phone, player_email,
                        parent_name, parent_email, parent_phone, notes )`
    )
    .eq("season_id", seasonId)
    .order("jersey_number", { nullsFirst: false });

  if (error) throw new Error(`Could not load the roster: ${error.message}`);
  return data ?? [];
}

/**
 * Players in the organization who are NOT on this season's roster.
 *
 * Powers the search-first add flow: a returning player gets assigned rather
 * than duplicated. Player identity is persistent across seasons.
 */
export async function listAssignablePlayers(organizationId, seasonId) {
  const supabase = createClient();

  const { data: assigned } = await supabase
    .from("team_season_players")
    .select("player_id")
    .eq("season_id", seasonId);

  const taken = (assigned ?? []).map((r) => r.player_id).filter(Boolean);

  let q = supabase
    .from("players")
    .select("id, full_name, person_type, grad_year")
    .eq("organization_id", organizationId)
    .order("full_name");

  if (taken.length > 0) q = q.not("id", "in", `(${taken.join(",")})`);

  const { data, error } = await q;
  if (error) throw new Error(`Could not load existing players: ${error.message}`);
  return data ?? [];
}

/** Which fields a coach still needs to fill in. Derived, never stored. */
export function missingInfo(row) {
  const p = row.player ?? {};
  const gaps = [];
  if (row.jersey_number == null) gaps.push("jersey number");
  if (!row.positions?.length) gaps.push("position");
  if (!row.jersey_size) gaps.push("jersey size");
  if (!row.pants_size) gaps.push("pants size");
  if (p.person_type === "player" && !p.grad_year) gaps.push("grad year");
  if (!p.parent_email && !p.parent_phone && !p.player_email) gaps.push("contact");
  return gaps;
}

export function deriveSummary(rows) {
  const active = rows.filter((r) => r.is_active);
  const players = active.filter((r) => r.player?.person_type === "player");
  const staff = active.filter((r) => r.player?.person_type !== "player");
  const incomplete = rows.filter((r) => r.is_active && missingInfo(r).length > 0);

  return {
    playerCount: players.length,
    staffCount: staff.length,
    inactiveCount: rows.length - active.length,
    incompleteCount: incomplete.length,
  };
}
