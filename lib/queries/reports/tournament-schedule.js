import { createClient } from "../../supabase/server";
import {
  isGameWithinTournament, compareGames, compareTournaments,
  SCHEDULE_DECISIONS, isOnParentSchedule, isWaitlistedCommitment,
} from "../../schedule-rules";

/**
 * Payload for the parent-facing Tournament Schedule.
 *
 * ALLOWLIST, NOT A FILTER. Every field is constructed by hand. Nothing broad is
 * fetched and hidden in the template: a hidden field is still in the HTML and
 * one careless edit from being printed.
 *
 * Deliberately absent, and these must stay absent:
 *   - entry_fee, gate_fee, total_cost, budget_item_id
 *   - paid_status, except as the single fact "this Committed tournament is
 *     waitlisted" (the waitlisted flag below); no other registration state
 *   - notes, history_notes, would_play_again, overall_rating
 *   - contact_id, tournament_provider_id, travel_type
 *   - registration_deadline (a coach's deadline, not a family's)
 *   - Declined tournaments, and the word "Declined" (it invites questions
 *     about money the coach has not raised). The decision is printed ONLY as
 *     "Committed" or "Considering", mapped explicitly below.
 *   - result, runs_for, runs_against, placement
 *   - every QAB field
 *
 * Scope is explicit: seasonId always, tournamentId optionally. The optional
 * narrowing exists because an individual tournament sheet is the same data over
 * fewer rows — one parameter, not a second report.
 */
export async function tournamentScheduleReport(seasonId, { tournamentId = null } = {}) {
  if (!seasonId) throw new Error("tournamentScheduleReport requires a seasonId.");

  const supabase = createClient();

  const { data: season, error: sErr } = await supabase
    .from("seasons")
    .select(
      `id, name,
       team:teams ( id, name, organization:organizations ( id, name, logo_url ) )`
    )
    .eq("id", seasonId)
    .maybeSingle();

  if (sErr) throw new Error(`Could not load the season: ${sErr.message}`);
  if (!season) return null;

  /**
   * Committed and Considering (2026-11; previously Committed only). Families
   * see possible weekends early, and every row says which it is, so a
   * tentative tournament is never read as a plan. Declined is never fetched.
   * A Considering tournament that has already ended is dropped — see
   * isOnParentSchedule.
   */
  const generatedAt = new Date();
  const today = generatedAt.toISOString().slice(0, 10);

  let tq = supabase
    .from("tournaments")
    .select(
      `id, name, start_date, end_date, location, decision, paid_status,
       facility:facilities ( name, city, state, street_address, zip )`
    )
    .eq("season_id", seasonId)
    .in("decision", SCHEDULE_DECISIONS);

  if (tournamentId) tq = tq.eq("id", tournamentId);

  const { data: tournamentRows, error: tErr } = await tq;
  if (tErr) throw new Error(`Could not load tournaments: ${tErr.message}`);

  const tournaments = (tournamentRows ?? []).filter((t) => isOnParentSchedule(t, today));
  const ids = tournaments.map((t) => t.id);

  const { data: gameRows, error: gErr } = ids.length
    ? await supabase
        .from("games")
        .select("id, tournament_id, game_date, start_time, opponent_name, game_type")
        .eq("season_id", seasonId)
        .in("tournament_id", ids)
    : { data: [], error: null };

  if (gErr) throw new Error(`Could not load games: ${gErr.message}`);

  const byTournament = new Map(ids.map((id) => [id, []]));
  /**
   * A game dated outside its tournament's range is excluded from the printable
   * document — printing an August game under a November heading is visibly
   * wrong to a parent. The games are NOT modified, and the condition is not
   * swallowed: the count is returned so the coach can be told, outside the
   * document, that something needs review.
   */
  let excludedForDate = 0;

  for (const g of gameRows ?? []) {
    const t = tournaments.find((x) => x.id === g.tournament_id);
    if (!t) continue;

    if (!isGameWithinTournament(g.game_date, t.start_date, t.end_date)) {
      excludedForDate += 1;
      continue;
    }

    byTournament.get(g.tournament_id).push({
      id: g.id,
      date: g.game_date,
      // Shown only when present. Never a placeholder — a blank time column on
      // fifteen of twenty-one games reads as broken software.
      startTime: g.start_time ?? null,
      opponent: g.opponent_name?.trim() || null,
      // Pool / Bracket / Championship / Friendly / Scrimmage. Results, scores
      // and notes are never fetched.
      gameType: g.game_type ?? null,
    });
  }

  /**
   * Location, as a family would need it. Structured facility when the coach
   * picked one, free text when they typed one, and nothing at all when neither
   * exists — the three states that occur in production. Never invented.
   */
  const placeOf = (t) => {
    if (t.facility?.name) {
      const cityState = [t.facility.city, t.facility.state].filter(Boolean).join(", ");
      const street = t.facility.street_address
        ? [t.facility.street_address, cityState, t.facility.zip].filter(Boolean).join(", ")
        : null;
      return { name: t.facility.name, area: cityState || null, address: street };
    }
    const typed = t.location?.trim();
    if (typed) return { name: null, area: typed, address: null };
    return null;
  };

  const schedule = tournaments
    .map((t) => ({
      id: t.id,
      name: t.name,
      startDate: t.start_date,
      endDate: t.end_date,
      place: placeOf(t),
      // Allowlisted vocabulary: only these two words can reach the document.
      status: t.decision === "Committed" ? "Committed" : "Considering",
      // True only for Committed + Waitlisted: the spot is not secured.
      waitlisted: isWaitlistedCommitment(t),
      games: byTournament.get(t.id).sort(compareGames),
    }))
    .sort(compareTournaments);

  return {
    scope: tournamentId ? "tournament" : "season",
    generatedAt: generatedAt.toISOString(),

    organization: {
      name: season.team?.organization?.name ?? null,
      logoUrl: season.team?.organization?.logo_url ?? null,
    },
    team: { name: season.team?.name ?? null },
    season: { name: season.name },

    tournaments: schedule,

    // Coach-facing only. Never rendered inside the printable document.
    warnings:
      excludedForDate > 0
        ? [
            {
              blocking: false,
              title: "Some games have dates outside their tournament",
              message:
                `${excludedForDate} ${excludedForDate === 1 ? "game has a date" : "games have dates"} ` +
                "outside their tournament's dates, so they aren't included in this schedule. " +
                "Nothing has been changed — review those games in Tournaments.",
            },
          ]
        : [],
  };
}
