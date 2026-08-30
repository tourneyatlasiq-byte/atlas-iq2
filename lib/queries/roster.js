import { createClient } from "../supabase/server";
import { planningPlayerColumns, POSITION_CODES } from "../intake/registry";

// Re-exported from the single vocabulary rather than restated.
export const POSITIONS = POSITION_CODES;
export const SIZES = ["YS", "YM", "YL", "AS", "AM", "AL", "AXL"];
export const PERSON_TYPES = ["player", "coach", "manager", "other"];
export const THROWS = ["R", "L"];
export const BATS = ["R", "L", "S"];

/**
 * Season roster: team_season_players joined to the persistent player.
 *
 * Scoped by season_id, which is also team scoping since a season belongs to
 * exactly one team. The legacy `roster` table is never read.
 *
 * The player columns are DERIVED from the intake registry, not hand-listed.
 * A hand-written list had already fallen behind the schema: high_school and
 * the three structured-name columns were missing, so the drawer's High school
 * row could never render and hasStructuredName() was always false — an
 * imported player with structured names would have been given the legacy
 * single Name field and drifted on the next edit, defeating the invariant that
 * work exists to protect. Deriving it means the UI cannot lag the data model.
 *
 * player_id is selected EXPLICITLY. It was omitted, so every consumer that
 * needed a player id fell through `row.player_id ?? row.id` to `id` — the
 * SEASON ASSIGNMENT id. Display was unaffected because it reads the embedded
 * `player` object, so the drawer showed a player's contacts correctly and then
 * refused to act on them: "That contact does not belong to this player."
 * Recruiting, dues, pickup history and the on-roster test failed the same way,
 * silently.
 *
 * `player_contacts` is EMBEDDED rather than fetched through a helper, so its
 * own B3 policies apply to it independently. That policy is structurally
 * identical to the one on `players` — same organization scope, same restriction
 * of the parent role to `auth_linked_player_ids()` — so a reader sees exactly
 * the contacts belonging to players they could already see. A SECURITY DEFINER
 * view would have made this function the guard instead of RLS, which is the
 * one thing this read must not do. The legacy `parent_*` columns stay selected
 * until C3b backfills them; `resolvePlayerContact()` decides which store wins.
 */
export async function listSeasonRoster(seasonId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("team_season_players")
    .select(
      `id, player_id, jersey_number, jersey_size, pants_size, position, positions, is_active, joined_at,
       player:players ( ${planningPlayerColumns().join(", ")},
                        parent_name, parent_phone,
                        player_contacts ( id, full_name, relationship, email, phone,
                                          preferred_method, is_primary, sort_order, created_at ),
                        player_links ( id, link_type, url, label ),
                        player_college_interests ( id, college_name, notes ) )`
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
/** Total players in the organization, regardless of roster status. */
export async function organizationPlayerCount(organizationId) {
  const supabase = createClient();
  const { count } = await supabase
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  return count ?? 0;
}

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

export function deriveSummary(rows) {
  const active = rows.filter((r) => r.is_active);
  const players = active.filter((r) => r.player?.person_type === "player");
  const staff = active.filter((r) => r.player?.person_type !== "player");

  // Player-only inactive. inactiveCount below includes staff, which is right
  // for the Team page's roster line but wrong beside a player total — "15
  // players · 1 inactive" must not be counting an inactive coach.
  const inactivePlayers = rows.filter(
    (r) => !r.is_active && r.player?.person_type === "player"
  );

  return {
    playerCount: players.length,
    staffCount: staff.length,
    inactiveCount: rows.length - active.length,
    inactivePlayerCount: inactivePlayers.length,
  };
}
