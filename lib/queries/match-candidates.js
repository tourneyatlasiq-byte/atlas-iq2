import { createClient } from "../supabase/server";
import { planningPlayerColumns } from "../intake/registry";

/**
 * Every player in the organization, as import matching candidates.
 *
 * ONE QUERY, USED BY BOTH SIDES.
 *
 * The preview used to be given the SEASON ROSTER while the server evaluated
 * the whole organization. A player in the organization but not on this
 * season's roster was therefore invisible to the browser and visible to the
 * server, so the coach was shown "Create" for someone the server would match.
 * Two different questions were being asked of two different populations and
 * the answers were compared as though they were the same.
 *
 * Organization scoping is RLS's, not a filter here: `players` is already
 * scoped to the caller's organization, and adding an explicit organization_id
 * predicate would imply the boundary lives in this query when it does not.
 * A player from another organization cannot appear in either population.
 *
 * The columns are DERIVED FROM THE REGISTRY. A hand-written list is what
 * caused an earlier defect: seven columns the planner diffs against were
 * never fetched, so an incoming value looked like a fill against nothing
 * rather than a conflict against a stored value. Matching evidence and
 * planning fields both come from here, so neither can be quietly dropped.
 *
 * Note what this does NOT do: matching a player who is not on the roster does
 * not put them on it. Season membership is the planner's and the RPC's
 * decision, unchanged.
 */
export async function listMatchCandidates(client) {
  const supabase = client ?? createClient();

  const { data, error } = await supabase
    .from("players")
    .select(`${planningPlayerColumns().join(", ")}, player_contacts ( id, email )`);

  if (error) throw new Error(`Could not load players for matching: ${error.message}`);
  return data ?? [];
}
