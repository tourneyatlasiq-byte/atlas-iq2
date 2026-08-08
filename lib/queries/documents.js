import { createClient } from "../supabase/server";

export { CATEGORIES, RESTRICTED_CATEGORIES, isRestricted } from "../documents";

/**
 * Documents for the current scope.
 *
 * RLS decides what comes back — season/organization scope, plus the category
 * gate that hides Birth Certificates from non-admins. There is deliberately no
 * category filtering here: relying on a query filter for security would fail
 * open the moment someone forgot it.
 *
 * One document row surfaces in several modules through its relationships. The
 * physical file is never duplicated.
 */
export async function listDocuments(seasonId, organizationId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("documents")
    .select(
      `id, category, file_name, file_path, notes, uploaded_at, file_size, mime_type,
       organization_id, season_id, player_id, tournament_id, facility_id, uploaded_by,
       player:players ( id, full_name ),
       tournament:tournaments ( id, name ),
       facility:facilities ( id, name, atlas_id ),
       season:seasons ( id, name )`
    )
    .order("uploaded_at", { ascending: false });

  if (error) throw new Error(`Could not load documents: ${error.message}`);
  return data ?? [];
}

/** Pickers for the upload form. */
export async function documentTargets(seasonId, organizationId) {
  const supabase = createClient();

  const [players, tournaments, facilities] = await Promise.all([
    supabase.from("players").select("id, full_name").eq("organization_id", organizationId).order("full_name"),
    supabase.from("tournaments").select("id, name").eq("season_id", seasonId).order("start_date"),
    supabase.from("facilities").select("id, name, atlas_id").order("name").limit(400),
  ]);

  return {
    players: players.data ?? [],
    tournaments: tournaments.data ?? [],
    facilities: facilities.data ?? [],
  };
}

/** What a document is attached to, for the "Related to" column. */
export function relatedTo(doc) {
  if (doc.player) return { kind: "Player", label: doc.player.full_name };
  if (doc.tournament) return { kind: "Tournament", label: doc.tournament.name };
  if (doc.facility) return { kind: "Facility", label: doc.facility.name };
  if (doc.season) return { kind: "Season", label: doc.season.name };
  return { kind: "Organization", label: "Organization-wide" };
}

export function documentSummary(docs) {
  return {
    total: docs.length,
    player: docs.filter((d) => d.player_id).length,
    tournament: docs.filter((d) => d.tournament_id).length,
    orgTeam: docs.filter((d) => !d.player_id && !d.tournament_id && !d.facility_id).length,
  };
}
