"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import { EDITABLE_FIELDS, FIELD_TYPES, toStoredValue } from "../facility-fields";

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
  return {
    name: text(formData.get("name")),
    street_address: text(formData.get("street_address")),
    city: text(formData.get("city")),
    state: text(formData.get("state")),
    zip: text(formData.get("zip")),
    latitude: decimal(formData.get("latitude")),
    longitude: decimal(formData.get("longitude")),
    website: text(formData.get("website")),
    field_count: int(formData.get("field_count")),
    surface_type: text(formData.get("surface_type")),
    county: text(formData.get("county")),
    indoor: tri(formData.get("indoor")),
    lights: tri(formData.get("lights")),
    batting_cages: tri(formData.get("batting_cages")),
    concessions: tri(formData.get("concessions")),
    restrooms: tri(formData.get("restrooms")),
    playground: tri(formData.get("playground")),
    parking: text(formData.get("parking")),
    description: text(formData.get("description")),
    maps_link: text(formData.get("maps_link")),
    // Provider-neutral external identity. Populated when a facility was created
    // from an external place result; null for manual entry.
    external_place_id: text(formData.get("external_place_id")),
    external_source: text(formData.get("external_source")),
  };
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
    if (!fields.name) return { ok: false, error: "Enter a facility name." };

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
