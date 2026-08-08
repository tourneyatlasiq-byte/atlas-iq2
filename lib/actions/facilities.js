"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";

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

    const { error } = await supabase.from("facilities").insert({
      ...fields,
      created_by_organization_id: ctx.organization.id,
    });

    if (error) {
      if (error.code === "23505") {
        return {
          ok: false,
          error: "That external place is already in Atlas as a facility. Search for it above and use the existing record.",
        };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/facilities");
    return { ok: true };
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
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const fields = facilityFields(formData);
    if (!fields.name) return { ok: false, error: "Enter a facility name." };

    const { error } = await supabase.from("facilities").update(fields).eq("id", id);
    if (error) {
      if (error.code === "42501" || error.message?.includes("policy")) {
        return {
          ok: false,
          error: "This facility was added by another organization, so its shared details can't be edited here. Your own notes can still be saved.",
        };
      }
      return { ok: false, error: error.message };
    }

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
        error: `This facility is referenced by ${blockers.join(" and ")}. Facilities are shared across Atlas, so it can't be deleted while anything depends on it.`,
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
