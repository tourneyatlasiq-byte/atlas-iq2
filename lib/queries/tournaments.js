import { createClient } from "../supabase/server";

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
  return data ?? [];
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

/**
 * Derives the "needs action" list. Nothing is stored — these are questions the
 * data can already answer, and the reason is stated per row rather than shown
 * as a generic flag.
 */
export function deriveActions(tournaments, today = new Date()) {
  const days = (d) => Math.ceil((new Date(d + "T00:00:00") - today) / 86400000);
  const out = [];

  for (const t of tournaments) {
    const away = t.start_date ? days(t.start_date) : null;
    if (away === null || away < 0) continue;

    const deadline = t.registration_deadline ? days(t.registration_deadline) : null;

    if (
      t.decision === "Committed" &&
      t.paid_status === "Not Registered" &&
      deadline !== null && deadline >= 0 && deadline <= 14
    ) {
      out.push({
        t,
        reason: `Registration closes in ${deadline} ${deadline === 1 ? "day" : "days"}`,
        urgency: "high",
      });
    } else if (t.decision === "Committed" && t.paid_status === "Not Registered") {
      out.push({ t, reason: "Committed but not registered yet", urgency: away <= 30 ? "high" : "normal" });
    } else if (t.decision === "Committed" && t.paid_status !== "Paid in Full" && away <= 30) {
      out.push({ t, reason: `Starts in ${away} ${away === 1 ? "day" : "days"} and isn't paid in full`, urgency: "high" });
    } else if (t.decision === "Considering" && away <= 21) {
      out.push({ t, reason: `Starts in ${away} ${away === 1 ? "day" : "days"} — decide soon`, urgency: "high" });
    }
  }

  return out.sort((a, b) => new Date(a.t.start_date) - new Date(b.t.start_date));
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
