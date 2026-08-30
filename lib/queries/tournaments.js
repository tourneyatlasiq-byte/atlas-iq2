import { createClient } from "../supabase/server";
import { recordFrom } from "../game-rules";
import { sumMoney } from "../finance-rules";

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
       would_play_again, overall_rating, history_notes, contact_id,
       provider:tournament_providers ( id, name, website_url ),
       facility:facilities ( id, name, city, state, zip, street_address, maps_link )`
    )
    .eq("season_id", seasonId)
    .order("start_date");

  if (error) throw new Error(`Could not load tournaments: ${error.message}`);

  // Games belong to tournaments, so they load with them rather than as a
  // separate module.
  // qab_completed_at, the lineup count and whether any plate appearance exists
  // travel with the game so the drawer can label its action for the state the
  // game is actually in. Both relations are QAB-gated in RLS, so a non-QAB
  // organization reads zero for each and the drawer shows no QAB action at
  // all — the gate stays in one place.
  const { data: games } = await supabase
    .from("games")
    .select(
      `id, tournament_id, game_date, start_time, opponent_name, result,
       runs_for, runs_against, game_type, notes, qab_completed_at,
       lineup:game_lineup_slots ( id ),
       pas:plate_appearances ( id )`
    )
    .eq("season_id", seasonId)
    .order("game_date")
    .order("start_time", { nullsFirst: true });

  const byTournament = new Map();
  for (const raw of games ?? []) {
    const { lineup, pas, ...g } = raw;
    const game = {
      ...g,
      batters: (lineup ?? []).length,
      plateAppearances: (pas ?? []).length,
      qabCompleted: Boolean(g.qab_completed_at),
    };
    byTournament.set(game.tournament_id, [...(byTournament.get(game.tournament_id) ?? []), game]);
  }

  /**
   * Places this organization associated with each tournament: the hotel, the
   * restaurant. RLS scopes tournament_resources to the caller's organization,
   * so no second filter is needed here and none is written — the boundary
   * lives in one place.
   *
   * DELIBERATELY NOT the playing venue. That is tournaments.facility_id,
   * embedded above as `facility`, and nothing here touches it. A tournament
   * with a playing facility and no linked resources has an empty list, because
   * the venue is not itself an association a coach chose to record.
   */
  const tournamentIds = (data ?? []).map((t) => t.id);
  const { data: resources } = tournamentIds.length === 0
    ? { data: [] }
    : await supabase
    .from("tournament_resources")
    .select(
      `id, tournament_id, context, facility_id,
       facility:facilities ( id, name, type, city, state )`
    )
    .in("tournament_id", tournamentIds);

  const resourcesByTournament = new Map();
  for (const r of resources ?? []) {
    resourcesByTournament.set(r.tournament_id, [
      ...(resourcesByTournament.get(r.tournament_id) ?? []),
      r,
    ]);
  }

  return (data ?? []).map((t) => ({
    ...t,
    games: byTournament.get(t.id) ?? [],
    resources: resourcesByTournament.get(t.id) ?? [],
  }));
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
    // type comes along so the picker can distinguish a hotel from a ballpark
    // at a glance; 180 records is already too many to tell apart by name.
    supabase.from("facilities").select("id, name, city, state, type").order("name"),
  ]);

  return {
    providers: providers.data ?? [],
    facilities: facilities.data ?? [],
  };
}

/** Season-level rollup for the summary tiles. */
export function deriveSummary(tournaments, today = new Date()) {
  const committed = tournaments.filter((t) => t.decision === "Committed");
  // sumMoney, not a raw float reduce. Finance works in cents precisely so a
  // value like 53,269.55 cannot accumulate a remainder; this tile summarises
  // the same money and was the one place adding it as floats. Two
  // implementations of "committed tournament cost" could disagree by a penny
  // and leave the Tournaments tile arguing with the Finance page.
  const committedCost = sumMoney(committed.map((t) => t.total_cost ?? 0));

  const upcoming = tournaments
    .filter((t) => t.decision === "Committed" && t.start_date && new Date(t.start_date + "T00:00:00") >= today)
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

  const next = upcoming[0] ?? null;
  const daysToNext = next
    ? Math.ceil((new Date(next.start_date + "T00:00:00") - today) / 86400000)
    : null;

  return { committedCount: committed.length, committedCost, next, daysToNext, upcoming };
}
