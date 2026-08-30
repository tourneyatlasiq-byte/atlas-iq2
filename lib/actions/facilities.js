"use server";

import { revalidatePath } from "next/cache";
import { RESOURCE_TYPE_KEYS } from "../facility-fields";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import { EDITABLE_FIELDS, FIELD_TYPES, toStoredValue } from "../facility-fields";
import { findCatalogDuplicates, DUPLICATE_RULES } from "../facility-matching";
import { geocodeAddress } from "../geocoding/geocodio";
import { decideAddress, describeDecision } from "../facility-address-rules";

/**
 * Facility writes.
 *
 * Two distinct surfaces:
 *   facilities              canonical shared record, editable by the creating org
 *   organization_facilities this organization's private operational notes
 *
 * facilities.notes and facilities.region are legacy and never written.
 */

/** Three-state: "true" / "false" / "" -> true / false / null. */
function tri(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  return s === "true";
}

function text(v) {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function int(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
}

function decimal(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to facilities.");
  return ctx;
}

function facilityFields(formData) {
  // A submitted type is validated rather than trusted, and anything else
  // becomes 'facility' — the column default and the safe reading of an
  // unexpected value.
  const submittedType = text(formData.get("type"));
  const type = RESOURCE_TYPE_KEYS.includes(submittedType) ? submittedType : "facility";

  // Lodging and dining have no fields, surface, cages or playground. Writing
  // nulls for them is deliberate: if a record's type is later corrected from
  // facility to lodging, the stale ballpark attributes go with it rather than
  // lingering invisibly behind a form that no longer shows them.
  const facilityOnly = type === "facility";

  return {
    type,
    name: text(formData.get("name")),
    phone: text(formData.get("phone")),
    street_address: text(formData.get("street_address")),
    city: text(formData.get("city")),
    state: text(formData.get("state")),
    zip: text(formData.get("zip")),
    latitude: decimal(formData.get("latitude")),
    longitude: decimal(formData.get("longitude")),
    website: text(formData.get("website")),
    field_count: facilityOnly ? int(formData.get("field_count")) : null,
    surface_type: facilityOnly ? text(formData.get("surface_type")) : null,
    county: text(formData.get("county")),
    indoor: facilityOnly ? tri(formData.get("indoor")) : null,
    lights: facilityOnly ? tri(formData.get("lights")) : null,
    batting_cages: facilityOnly ? tri(formData.get("batting_cages")) : null,
    concessions: facilityOnly ? tri(formData.get("concessions")) : null,
    restrooms: facilityOnly ? tri(formData.get("restrooms")) : null,
    playground: facilityOnly ? tri(formData.get("playground")) : null,
    parking: facilityOnly ? text(formData.get("parking")) : null,
    // Facility-only, like the operational fields above. A hotel's shared
    // record carries no description; a coach's experience of it goes in the
    // organization-private notes instead.
    description: facilityOnly ? text(formData.get("description")) : null,
    maps_link: text(formData.get("maps_link")),
    // Provider-neutral external identity. Populated when a facility was created
    // from an external place result; null for manual entry.
    external_place_id: text(formData.get("external_place_id")),
    external_source: text(formData.get("external_source")),
  };
}

/**
 * Ids the coach was actually shown and confirmed were different facilities.
 *
 * Scoped on purpose. A bare boolean override would let a stale acknowledgement
 * wave through a duplicate created by someone else between the two submits.
 */
function acknowledgedIds(formData) {
  return new Set(
    (formData.get("acknowledged_duplicate_ids") ?? "")
      .toString()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Probable duplicates for a facility about to be created.
 *
 * Authoritative: Facilities Add warns client-side for UX, but creation cannot
 * bypass this. Quick Add relies on it entirely and carries no catalog.
 *
 * Only the three strong rules block. cross_city_name is deliberately never
 * returned — two towns in one state can each have a Riverside Park, so it is
 * information, never evidence.
 */
async function unacknowledgedDuplicates(supabase, fields, formData) {
  const { data, error } = await supabase
    .from("facilities")
    .select("id, atlas_id, name, name_normalized, city, state, street_address");

  // A read failure must not silently disable the safeguard, nor block a
  // legitimate creation. Surface it and let the caller decide.
  if (error) throw new Error(`Could not check for duplicate facilities: ${error.message}`);

  const acked = acknowledgedIds(formData);

  return findCatalogDuplicates(data ?? [], fields)
    .filter((m) => DUPLICATE_RULES.includes(m.rule))
    .filter((m) => !acked.has(m.facility.id))
    .map((m) => ({
      id: m.facility.id,
      atlas_id: m.facility.atlas_id,
      name: m.facility.name,
      street_address: m.facility.street_address,
      city: m.facility.city,
      state: m.facility.state,
      rule: m.rule,
    }));
}

/**
 * Creates a canonical facility. The search-first UI is the primary duplicate
 * defence; this only runs once the user has seen the matches and chosen to
 * proceed anyway, which is a legitimate outcome.
 */
export async function createFacility(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const fields = facilityFields(formData);
    if (!fields.name) return { ok: false, error: "Enter a name." };

    const duplicates = await unacknowledgedDuplicates(supabase, fields, formData);
    if (duplicates.length > 0) {
      return {
        ok: false,
        duplicate: true,
        error: "This facility may already be in Season Tempo.",
        duplicates,
      };
    }

    // `created` is returned to callers: QuickAddFacility passes it to
    // TournamentClient, which reads facility.id to link the new facility to the
    // tournament being edited. Without capturing data here the function threw
    // ReferenceError after a successful insert.
    const { data: created, error } = await supabase.from("facilities")
      .insert({
        ...fields,
        created_by_organization_id: ctx.organization.id,
      })
      .select("id, name, city, state")
      .single();

    if (error) {
      if (error.code === "23505") {
        return {
          ok: false,
          error: "That external place is already in Season Tempo as a facility. Search for it above and use the existing record.",
        };
      }
      return { ok: false, error: error.message };
    }

    /**
     * A RECORD YOU CREATED IS IMMEDIATELY SAVED.
     *
     * Without this a coach adds a hotel, the create succeeds, and it does not
     * appear under Saved — because Saved means a real relationship and a brand
     * new record has no tournament, no notes and no links yet. Creating it IS
     * that relationship.
     *
     * Recorded here rather than by adding created_by_organization_id to the
     * Saved rule, because the importer sets that column too: Northgate
     * imported 178 of the 181 records in the directory, and counting them
     * would make Saved almost identical to All. An organization_facilities row
     * is written only by a deliberate act, which is exactly the distinction.
     *
     * The row carries no notes. It is a relationship marker, which is what
     * this table has always been; RLS keeps it to the creating organization.
     *
     * Deliberately not fatal. The record exists and is correct; failing the
     * whole create over a Saved marker would be a worse outcome than a record
     * the coach can still find under All.
     */
    const { error: markErr } = await supabase
      .from("organization_facilities")
      .upsert(
        { organization_id: ctx.organization.id, facility_id: created.id },
        { onConflict: "organization_id,facility_id" }
      );
    if (markErr) {
      console.error("createFacility: could not mark as saved", {
        facilityId: created.id, error: markErr.message,
      });
    }

    revalidatePath("/facilities");
    return { ok: true, facility: created };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Updates the shared record. RLS restricts this to the creating organization,
 * so one org cannot rewrite another's canonical data.
 */
export async function updateFacility(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const fields = facilityFields(formData);
    if (!fields.name) return { ok: false, error: "Enter a facility name." };

    // Snapshot before the write so the audit trail records real old values
    // rather than whatever the form claimed they were.
    const { data: before } = await supabase
      .from("facilities")
      .select("*")
      .eq("id", id)
      .single();

    const { error } = await supabase.from("facilities").update(fields).eq("id", id);
    if (error) {
      if (error.code === "42501" || error.message?.includes("policy")) {
        return {
          ok: false,
          error: "This facility was added by another organization, so its shared details can't be edited here. You can suggest a correction instead.",
        };
      }
      return { ok: false, error: error.message };
    }

    await logAppliedChanges(supabase, ctx, id, before, fields);

    revalidatePath("/facilities");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Saves this organization's private notes. Upsert on (organization, facility). */
export async function saveOrgFacilityNotes(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const facilityId = text(formData.get("facility_id"));
    if (!facilityId) return { ok: false, error: "Missing facility reference." };

    const fields = {
      organization_id: ctx.organization.id,
      facility_id: facilityId,
      parking_notes: text(formData.get("parking_notes")),
      entry_notes: text(formData.get("entry_notes")),
      concessions_notes: text(formData.get("concessions_notes")),
      restroom_notes: text(formData.get("restroom_notes")),
      seating_notes: text(formData.get("seating_notes")),
      internal_notes: text(formData.get("internal_notes")),
      // ORGANIZATION-PRIVATE, like every column on this table. 'yes' or 'no',
      // and NULL for not rated -- there is no third stored value, because not
      // rated is the absence of a judgement rather than a judgement. An
      // unexpected value becomes NULL rather than failing the CHECK.
      would_use_again: ["yes", "no"].includes(text(formData.get("would_use_again")))
        ? text(formData.get("would_use_again"))
        : null,
    };

    const { error } = await supabase
      .from("organization_facilities")
      .upsert(fields, { onConflict: "organization_id,facility_id" });

    if (error) return { ok: false, error: error.message };
    revalidatePath("/facilities");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Deletes a canonical facility. Refuses when anything references it, because
 * facilities are shared — another organization's tournament may depend on it.
 */
export async function deleteFacility(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const head = { count: "exact", head: true };
    const [tournaments, transactions] = await Promise.all([
      supabase.from("tournaments").select("id", head).eq("facility_id", id),
      supabase.from("budget_transactions").select("id", head).eq("facility_id", id),
    ]);

    const blockers = [];
    if (tournaments.count) blockers.push(`${tournaments.count} tournament${tournaments.count === 1 ? "" : "s"}`);
    if (transactions.count) blockers.push(`${transactions.count} transaction${transactions.count === 1 ? "" : "s"}`);

    if (blockers.length) {
      return {
        ok: false,
        error: `This facility is referenced by ${blockers.join(" and ")}. Facilities are shared across Season Tempo, so it can't be deleted while anything depends on it.`,
      };
    }

    const { error } = await supabase.from("facilities").delete().eq("id", id);
    if (error) {
      if (error.code === "42501" || error.message?.includes("policy")) {
        return { ok: false, error: "Only the organization that added this facility can delete it." };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/facilities");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------------- Shared facility corrections ---------------- */

/**
 * Records an applied change against a facility.
 *
 * Called after a direct admin edit. One row per changed field, so the audit
 * trail reads field-by-field rather than as an opaque "record updated".
 */
async function logAppliedChanges(supabase, ctx, facilityId, before, after) {
  const rows = [];

  for (const { key } of EDITABLE_FIELDS) {
    const oldV = toStoredValue(before?.[key]);
    const newV = toStoredValue(after?.[key]);
    if (oldV === newV) continue;

    rows.push({
      facility_id: facilityId,
      field_name: key,
      current_value: oldV,
      proposed_value: newV,
      status: "applied",
      change_type: "direct",
      submitted_by: ctx.profile.id,
      submitted_by_organization_id: ctx.organization.id,
      reviewed_at: new Date().toISOString(),
    });
  }

  if (rows.length > 0) await supabase.from("facility_edits").insert(rows);
  return rows.length;
}

/**
 * Submits a correction suggestion.
 *
 * Used by anyone who cannot edit the shared record directly: coaches and
 * managers, and admins of organizations that did not create the facility.
 * RLS enforces status='pending' regardless of what is sent.
 */
export async function suggestFacilityCorrection(formData) {
  try {
    const ctx = await requireSeasonContext();
    if (!canWrite(ctx.profile)) {
      throw new Error("Your role doesn't allow submitting corrections.");
    }

    const supabase = createClient();

    const facilityId = text(formData.get("facility_id"));
    const fieldName = text(formData.get("field_name"));
    const proposed = text(formData.get("proposed_value"));

    if (!facilityId || !fieldName) return { ok: false, error: "Missing record reference." };
    if (!EDITABLE_FIELDS.some((f) => f.key === fieldName)) {
      return { ok: false, error: "That field can't be corrected." };
    }
    if (proposed === null) return { ok: false, error: "Enter a proposed value." };

    // Read the current value server-side rather than trusting the form, so the
    // audit record reflects what was actually there at submission time.
    const { data: facility } = await supabase
      .from("facilities")
      .select("*")
      .eq("id", facilityId)
      .single();

    const { error } = await supabase.from("facility_edits").insert({
      facility_id: facilityId,
      field_name: fieldName,
      current_value: toStoredValue(facility?.[fieldName]),
      proposed_value: proposed,
      status: "pending",
      change_type: "suggestion",
      source_reference: text(formData.get("source_reference")),
      submitted_by: ctx.profile.id,
      submitted_by_organization_id: ctx.organization.id,
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath("/facilities");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Approves a suggestion: writes the value to the canonical facility, marks the
 * suggestion applied, and supersedes any other pending suggestion for the same
 * field so two people proposing the same fix doesn't leave a stale row.
 *
 * Only the curating organization's admin can reach this — enforced by RLS on
 * both facilities and facility_edits, not by this code.
 */
export async function approveFacilityCorrection(formData) {
  try {
    const ctx = await requireSeasonContext();
    const supabase = createClient();

    const editId = text(formData.get("edit_id"));
    if (!editId) return { ok: false, error: "Missing record reference." };

    const { data: edit } = await supabase
      .from("facility_edits")
      .select("id, facility_id, field_name, proposed_value, status")
      .eq("id", editId)
      .single();

    if (!edit) return { ok: false, error: "That suggestion could not be found." };
    if (edit.status !== "pending") return { ok: false, error: "That suggestion has already been reviewed." };

    const type = FIELD_TYPES[edit.field_name];
    let value = edit.proposed_value;
    if (type === "bool") value = edit.proposed_value === "true";
    else if (type === "number") value = edit.proposed_value === null ? null : Number(edit.proposed_value);

    const { error: updateError } = await supabase
      .from("facilities")
      .update({ [edit.field_name]: value })
      .eq("id", edit.facility_id);

    if (updateError) {
      if (updateError.code === "42501" || updateError.message?.includes("policy")) {
        return { ok: false, error: "Only the organization that added this facility can approve corrections for it." };
      }
      return { ok: false, error: updateError.message };
    }

    const reviewed = {
      status: "applied",
      reviewed_by: ctx.profile.id,
      reviewed_at: new Date().toISOString(),
      review_note: text(formData.get("review_note")),
    };

    const { error: markError } = await supabase
      .from("facility_edits")
      .update(reviewed)
      .eq("id", editId);

    if (markError) return { ok: false, error: markError.message };

    await supabase
      .from("facility_edits")
      .update({ status: "superseded", reviewed_by: ctx.profile.id, reviewed_at: reviewed.reviewed_at })
      .eq("facility_id", edit.facility_id)
      .eq("field_name", edit.field_name)
      .eq("status", "pending");

    revalidatePath("/facilities");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Rejects a suggestion. The canonical facility is untouched. */
export async function rejectFacilityCorrection(formData) {
  try {
    const ctx = await requireSeasonContext();
    const supabase = createClient();

    const editId = text(formData.get("edit_id"));
    if (!editId) return { ok: false, error: "Missing record reference." };

    const { error, count } = await supabase
      .from("facility_edits")
      .update(
        {
          status: "rejected",
          reviewed_by: ctx.profile.id,
          reviewed_at: new Date().toISOString(),
          review_note: text(formData.get("review_note")),
        },
        { count: "exact" }
      )
      .eq("id", editId)
      .eq("status", "pending");

    if (error) return { ok: false, error: error.message };
    if (count === 0) {
      return { ok: false, error: "Only the organization that added this facility can review its corrections." };
    }

    revalidatePath("/facilities");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Validate a facility address against Geocodio. READ ONLY.
 *
 * Writes nothing. It returns a decision the coach acts on; applying a change
 * still goes through createFacility/updateFacility exactly as before, so no
 * facility can be modified by a lookup.
 *
 * This is the only caller of the Geocodio boundary, and it is a server action,
 * so GEOCODIO_API_KEY never enters the client bundle. The candidates it
 * receives carry no coordinates and no vendor identifiers — those are dropped
 * inside lib/geocoding/geocodio.js and cannot reach this payload.
 *
 * Never throws and never blocks: if Geocodio is unavailable the decision is
 * "unusable", which means "save what the coach typed".
 */
export async function lookupFacilityAddress({ streetAddress, city, state, zip }) {
  try {
    await requireSeasonContext();

    const stored = {
      streetAddress: streetAddress ?? null,
      city: city ?? null,
      state: state ?? null,
      zip: zip ?? null,
    };

    const { ok, candidates, reason } = await geocodeAddress(stored);
    const decision = ok
      ? decideAddress(stored, candidates)
      : { status: "unusable", reason: reason ?? "no_results", suggestion: null, changes: {} };

    // Explicit field-by-field construction. Nothing from the vendor response
    // reaches the client except the four address components and the accuracy
    // context the coach is shown.
    return {
      ok: true,
      status: decision.status,
      message: describeDecision(decision),
      changes: decision.changes,
      suggestion: decision.suggestion
        ? {
            streetAddress: [decision.suggestion.number, decision.suggestion.street]
              .filter(Boolean)
              .join(" "),
            city: decision.suggestion.city,
            state: decision.suggestion.state,
            zip: decision.suggestion.zip,
            accuracyType: decision.suggestion.accuracyType,
            accuracy: decision.suggestion.accuracy,
          }
        : null,
    };
  } catch {
    // A failed lookup is never an error the coach has to clear.
    return {
      ok: true,
      status: "unusable",
      message: "We couldn't verify this address. It will be saved as you entered it.",
      changes: {},
      suggestion: null,
    };
  }
}

/* ---------------------------------------------------------------- linking --

   A tournament's PLAYING VENUE stays on tournaments.facility_id and is not
   touched by anything below. These actions manage the other associations: the
   hotel the families liked, the restaurant that could seat a team.

   A link means the organization wants to remember the place in connection with
   that trip. It does NOT mean every family used it, that it was an official
   team hotel, or that Season Tempo booked anything.
*/

const LINK_CONTEXTS = ["used", "recommended", "considered"];

export async function linkTournamentResource(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const tournamentId = text(formData.get("tournament_id"));
    const facilityId = text(formData.get("facility_id"));
    if (!tournamentId || !facilityId) {
      return { ok: false, error: "Choose a tournament and a place to link." };
    }

    const submitted = text(formData.get("context"));
    const context = LINK_CONTEXTS.includes(submitted) ? submitted : "used";

    // Re-linking the same pair UPDATES the context instead of stacking a
    // duplicate: a place considered last year and used this year is one
    // relationship whose context changed, not two relationships.
    const { error } = await supabase
      .from("tournament_resources")
      .upsert(
        {
          organization_id: ctx.organization.id,
          tournament_id: tournamentId,
          facility_id: facilityId,
          context,
          created_by: ctx.user.id,
        },
        { onConflict: "tournament_id,facility_id" }
      );

    if (error) return { ok: false, error: error.message };

    revalidatePath("/facilities");
    revalidatePath("/tournaments");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function unlinkTournamentResource(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing link reference." };

    // Removing an association forgets a note, not a place or a tournament.
    // Both records are untouched, and RLS keeps this to the owning org.
    const { data: removed, error } = await supabase
      .from("tournament_resources")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) return { ok: false, error: error.message };
    if ((removed ?? []).length === 0) {
      return { ok: false, error: "That link no longer exists." };
    }

    revalidatePath("/facilities");
    revalidatePath("/tournaments");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
