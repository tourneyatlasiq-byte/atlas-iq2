import { createClient } from "../../supabase/server";
import { groupPlayerChoices } from "../../qab-player-rules";

/**
 * Who the individual QAB report can be opened for, this season (2026-11).
 *
 * The same eligibility the report applies (qabPlayerReport): a roster row on
 * this team's season, or a recorded plate appearance in it. Names and counts
 * only; no QAB figure is computed here and nothing about a game, score or
 * teammate is read. The route calls this only after the QAB and coach-side
 * gates, and RLS bounds every read to the signed-in organization.
 *
 * Returns { active, inactive, pickup }, each [{ id, name, pa }].
 */
export async function qabPlayerChoices(seasonId) {
  if (!seasonId) throw new Error("qabPlayerChoices requires a seasonId.");
  const supabase = createClient();

  const { data: seasonRow } = await supabase.from("seasons").select("team_id").eq("id", seasonId).maybeSingle();

  const { data: rosterRows, error: rErr } = await supabase
    .from("team_season_players")
    .select("player_id, team_id, is_active, player:players ( id, full_name, person_type )")
    .eq("season_id", seasonId);
  if (rErr) throw new Error(`Could not load the roster: ${rErr.message}`);

  const { data: paRows, error: pErr } = await supabase
    .from("plate_appearances")
    .select("player_id, player:players ( id, full_name )")
    .eq("season_id", seasonId)
    .is("voided_at", null);
  if (pErr) throw new Error(`Could not load tracked at-bats: ${pErr.message}`);

  return groupPlayerChoices({ rosterRows, paRows, teamId: seasonRow?.team_id ?? null });
}
