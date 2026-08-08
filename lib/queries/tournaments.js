import { createClient } from "../supabase/server";
import { recordFrom } from "../game-rules";

export const DECISIONS = ["Considering", "Committed", "Declined"];
export const PAID_STATUSES = ["Not Registered", "Registered", "Deposit Paid", "Paid in Full"];
export const TRAVEL_TYPES = ["Day Trip", "Overnight", "Extended Stay"];

/** Tournaments for a season, with provider and facility resolved. */
export async function listSeasonTournaments(seasonId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("tournaments")
    .select(
      `id, name, start_date, end_date, location, entry_fee, gate_fee, total_cost,
       travel_type, decision, paid_status, placement, notes, event_url,
       age_division, tournament_type, guaranteed_games, registration_deadline,
       would_play_again, overall_rating, history_notes,
       provider:tournament_providers ( id, name, website_url ),
       facility:facilities ( id, name, city, state, maps_link )`
    )
    .eq("season_id", seasonId)
    .order("start_date");

  if (error) throw new Error(`Could not load tournaments: ${error.message}`);

  // Games belong to tournaments, so they load with them rather than as a
  // separate module.
  const { data: games } = await supabase
    .from("games")
    .select("id, tournament_id, game_date, start_time, opponent_name, result, runs_for, runs_against, game_type, notes")
    .eq("season_id", seasonId)
    .order("game_date")
    .order("start_time", { nullsFirst: true });

  const byTournament = new Map();
  for (const g of games ?? []) {
    byTournament.set(g.tournament_id, [...(byTournament.get(g.tournament_id) ?? []), g]);
  }

  return (data ?? []).map((t) => ({ ...t, games: byTournament.get(t.id) ?? [] }));
}

/**
 * Season record across every tournament.
 *
 * Delegates to recordFrom() so the season tile and the per-tournament line can
 * never disagree about what counts as a played game.
 */
export function seasonRecord(tournaments, today = new Date()) {
  return recordFrom(tournaments.flatMap((t) => t.games ?? []), today);
}

/** Shared reference entities for the create/edit form selects. */
export async function listReferenceData() {
  const supabase = createClient();

  const [providers, facilities] = await Promise.all([
    supabase.from("tournament_providers").select("id, name").order("name"),
    supabase.from("facilities").select("id, name, city, state").order("name"),
  ]);

  return {
    providers: providers.data ?? [],
    facilities: facilities.data ?? [],
  };
}

/** Season-level rollup for the summary tiles. */
export function deriveSummary(tournaments, today = new Date()) {
  const committed = tournaments.filter((t) => t.decision === "Committed");
  const committedCost = committed.reduce((sum, t) => sum + Number(t.total_cost ?? 0), 0);

  const upcoming = tournaments
    .filter((t) => t.decision === "Committed" && t.start_date && new Date(t.start_date + "T00:00:00") >= today)
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

  const next = upcoming[0] ?? null;
  const daysToNext = next
    ? Math.ceil((new Date(next.start_date + "T00:00:00") - today) / 86400000)
    : null;

  return { committedCount: committed.length, committedCost, next, daysToNext };
}
