import { createClient } from "../supabase/server";

export { EDITABLE_FIELDS, FIELD_LABELS, FIELD_TYPES, displayValue, toStoredValue } from "../facility-fields";

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

  const [facilities, orgNotes, tournaments, edits, resourceLinks] = await Promise.all([
    supabase
      .from("facilities")
      .select(
        `id, atlas_id, name, street_address, city, state, zip, latitude, longitude,
         website, field_count, surface_type, maps_link, image_url,
         county, indoor, lights, batting_cages, concessions, restrooms,
         playground, parking, description, data_source,
         external_place_id, external_source, name_normalized,
         created_by_organization_id, type, phone, created_at, updated_at`
      )
      .order("name"),
    supabase
      .from("organization_facilities")
      .select(
        `id, facility_id, parking_notes, entry_notes, concessions_notes,
         restroom_notes, seating_notes, internal_notes, would_use_again`
      )
      .eq("organization_id", organizationId),
    supabase
      .from("tournaments")
      .select("id, name, start_date, end_date, facility_id, decision, placement, season_id")
      .not("facility_id", "is", null)
      .order("start_date", { ascending: false }),
    // RLS decides what is visible here: applied rows are public history,
    // pending and rejected are limited to the submitting and curating orgs.
    supabase
      .from("facility_edits")
      .select(
        `id, facility_id, field_name, current_value, proposed_value, status,
         change_type, source_reference, submitted_at, reviewed_at, review_note,
         submitted_by_organization_id,
         org:organizations!facility_edits_submitted_by_organization_id_fkey ( id, name )`
      )
      .order("submitted_at", { ascending: false }),
    // Places this organization has associated with a tournament. Deliberately
    // separate from tournaments.facility_id, which is the playing venue: a
    // hotel linked to a trip is not where the games were played, and a link
    // never means every family used it.
    supabase
      .from("tournament_resources")
      .select(
        `id, facility_id, context, tournament_id,
         tournament:tournaments ( id, name, start_date, end_date, season_id )`
      )
      .eq("organization_id", organizationId),
  ]);


  if (facilities.error) throw new Error(`Could not load facilities: ${facilities.error.message}`);

  const notesBy = new Map((orgNotes.data ?? []).map((n) => [n.facility_id, n]));

  const editsBy = new Map();
  for (const e of edits.data ?? []) {
    editsBy.set(e.facility_id, [...(editsBy.get(e.facility_id) ?? []), e]);
  }
  const iso = today.toISOString().slice(0, 10);

  const linksBy = new Map();
  for (const l of resourceLinks.data ?? []) {
    linksBy.set(l.facility_id, [...(linksBy.get(l.facility_id) ?? []), l]);
  }

  const byFacility = new Map();
  for (const t of tournaments.data ?? []) {
    const list = byFacility.get(t.facility_id) ?? [];
    list.push(t);
    byFacility.set(t.facility_id, list);
  }

  // RLS scopes tournaments to seasons the current user can access, so
  // everything above is already in scope.
  return (facilities.data ?? []).map((f) => {
    const history = byFacility.get(f.id) ?? [];
    const upcoming = history.filter((t) => (t.end_date ?? t.start_date) >= iso);
    const past = history.filter((t) => (t.end_date ?? t.start_date) < iso);
    const orgNotes = notesBy.get(f.id) ?? null;

    /**
     * Our Venues qualification.
     *
     * A facility qualifies when EITHER:
     *   - a non-Declined tournament in an accessible season is held there, or
     *   - this organization has saved notes for it.
     *
     * Declined alone does not qualify: considering a venue and turning it down
     * is not the same as having used or documented it. Those appear only under
     * All Facilities.
     */
    const committedHistory = history.filter((t) => t.decision !== "Declined");

    const facilityEdits = editsBy.get(f.id) ?? [];

    /**
     * Tournament associations, newest first. This is the accumulated knowledge
     * the feature exists for: the same hotel linked to Sparkler 2026 and again
     * in 2027 gives a coach returning to the area something to go on.
     *
     * It is also the history a future "previously used near this tournament"
     * would read. Nothing infers anything from it today.
     */
    const links = (linksBy.get(f.id) ?? []).sort((a, b) =>
      (b.tournament?.start_date ?? "").localeCompare(a.tournament?.start_date ?? "")
    );

    return {
      ...f,
      type: f.type ?? "facility",
      orgNotes,
      resourceLinks: links,
      linkedTournamentCount: links.length,
      history,
      upcoming,
      past,
      upcomingCount: upcoming.length,
      pastCount: past.length,
      // A lodging or dining record has no games, so tournament history alone
      // would hide it from Our Places forever. A link or a saved note is the
      // same signal for those types that a played tournament is for a field.
      isOurs: committedHistory.length > 0 || orgNotes !== null || links.length > 0,
      pendingEdits: facilityEdits.filter((e) => e.status === "pending"),
      appliedEdits: facilityEdits.filter((e) => e.status === "applied"),
      // Curation follows creation: only this organization may edit directly
      // and review suggestions for this facility.
      isCurator: f.created_by_organization_id === organizationId,
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


/**
 * Parking and entry notes for the facilities this season's tournaments use.
 *
 * Deliberately narrow: only the two notes a coach needs between pulling into
 * the complex and reaching the right field. Concessions, restrooms and seating
 * stay in Facility details — they are not arrival-critical.
 *
 * Private to the organization, like everything in organization_facilities.
 */
export async function arrivalNotesByFacility(organizationId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("organization_facilities")
    .select("facility_id, parking_notes, entry_notes")
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Could not load facility notes: ${error.message}`);

  const byFacility = {};
  for (const row of data ?? []) {
    if (!row.parking_notes && !row.entry_notes) continue;
    byFacility[row.facility_id] = {
      parking: row.parking_notes || null,
      entry: row.entry_notes || null,
    };
  }
  return byFacility;
}
