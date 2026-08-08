import { createClient } from "../supabase/server";

/**
 * Facilities are canonical shared Atlas records — one row per real-world
 * complex, visible to every organization. Only globally true facts live on
 * the facility. Organization-specific operational knowledge lives in
 * organization_facilities and is private to that organization.
 *
 * facilities.notes and facilities.region are legacy and never read here.
 */

/**
 * All facilities, with this organization's private notes and derived tournament
 * history. History is always derived from tournaments.facility_id — no counts
 * are stored.
 */
export async function listFacilities(organizationId, today = new Date()) {
  const supabase = createClient();

  const [facilities, orgNotes, tournaments] = await Promise.all([
    supabase
      .from("facilities")
      .select(
        `id, atlas_id, name, street_address, city, state, zip, latitude, longitude,
         website, field_count, surface_type, maps_link, image_url,
         county, indoor, lights, batting_cages, concessions, restrooms,
         playground, parking, description, data_source,
         external_place_id, external_source, name_normalized,
         created_by_organization_id`
      )
      .order("name"),
    supabase
      .from("organization_facilities")
      .select(
        `id, facility_id, parking_notes, entry_notes, concessions_notes,
         restroom_notes, seating_notes, internal_notes`
      )
      .eq("organization_id", organizationId),
    supabase
      .from("tournaments")
      .select("id, name, start_date, end_date, facility_id, decision, placement, season_id")
      .not("facility_id", "is", null)
      .order("start_date", { ascending: false }),
  ]);


  if (facilities.error) throw new Error(`Could not load facilities: ${facilities.error.message}`);

  const notesBy = new Map((orgNotes.data ?? []).map((n) => [n.facility_id, n]));
  const iso = today.toISOString().slice(0, 10);

  const byFacility = new Map();
  for (const t of tournaments.data ?? []) {
    const list = byFacility.get(t.facility_id) ?? [];
    list.push(t);
    byFacility.set(t.facility_id, list);
  }

  // RLS scopes tournaments to this organization's seasons, so everything above
  // is already ours — no further filtering needed.
  return (facilities.data ?? []).map((f) => {
    const history = byFacility.get(f.id) ?? [];
    const upcoming = history.filter((t) => (t.end_date ?? t.start_date) >= iso);
    const past = history.filter((t) => (t.end_date ?? t.start_date) < iso);
    const orgNotes = notesBy.get(f.id) ?? null;

    return {
      ...f,
      orgNotes,
      history,
      upcomingCount: upcoming.length,
      pastCount: past.length,
      // "Ours" = we have played here, or written something about it.
      isOurs: history.length > 0 || orgNotes !== null,
    };
  });
}

/** Normalized the same way as the generated column, for client-side matching. */
export function normalizeName(name) {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Likely duplicates: same normalized name in the same city.
 *
 * A warning, never a block. Distinct facilities legitimately share names in
 * different towns, and a hard constraint would eventually stop someone
 * entering a real venue.
 */
export function likelyDuplicates(facilities, name, city, excludeId = null) {
  const n = normalizeName(name);
  if (!n) return [];
  const c = (city ?? "").trim().toLowerCase();
  return facilities.filter(
    (f) =>
      f.id !== excludeId &&
      f.name_normalized === n &&
      (!c || (f.city ?? "").trim().toLowerCase() === c)
  );
}

/** Free-text search across name, city, state and street address. */
export function searchFacilities(facilities, query) {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return facilities;
  return facilities.filter((f) =>
    `${f.atlas_id ?? ""} ${f.name} ${f.city ?? ""} ${f.state ?? ""} ${f.street_address ?? ""} ${f.zip ?? ""}`
      .toLowerCase()
      .includes(q)
  );
}
