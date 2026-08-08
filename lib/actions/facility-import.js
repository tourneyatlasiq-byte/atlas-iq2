"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import { normalizeName } from "../facility-import";

/**
 * Facility import.
 *
 * Facilities are canonical shared Atlas records, so an import must be safely
 * rerunnable — running the same CSV twice creates nothing the second time.
 *
 * Matching:
 *   normalized name + city + state  ->  already exists, SKIP
 *   normalized name + state only    ->  CREATE, flagged as a potential duplicate
 *   no match                        ->  CREATE
 *
 * The middle case is created rather than skipped because two towns in one
 * state can legitimately both have a "Riverside Park". Flagging it puts a
 * human in the loop without blocking a real facility.
 *
 * Organization-specific notes are never created here — those belong to an
 * organization, and an import produces canonical records only.
 */

const eq = (a, b) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export async function importFacilities(payload) {
  try {
    const ctx = await requireSeasonContext();
    if (!canWrite(ctx.profile)) {
      throw new Error("Your role doesn't allow importing facilities.");
    }

    const rows = payload?.rows ?? [];
    if (rows.length === 0) return { ok: true, created: [], skipped: [], duplicates: [], errors: [] };

    const supabase = createClient();

    // Existing facilities are read once and matched in memory — a per-row query
    // would be hundreds of round trips for a master list.
    const { data: existing, error: readError } = await supabase
      .from("facilities")
      .select("id, atlas_id, name, name_normalized, city, state");

    if (readError) throw new Error(`Could not read existing facilities: ${readError.message}`);

    const known = existing ?? [];
    const created = [];
    const skipped = [];
    const duplicates = [];
    const errors = [];

    // Rows added during this run, so a CSV containing its own duplicates
    // doesn't create both.
    const addedThisRun = [];

    for (const row of rows) {
      if (row.error) {
        errors.push({ line: row.lineNumber, name: row.name ?? "(no name)", reason: row.error });
        continue;
      }

      const norm = normalizeName(row.name);
      const pool = [...known, ...addedThisRun];

      const exact = pool.find(
        (f) => f.name_normalized === norm && eq(f.city, row.city) && eq(f.state, row.state)
      );

      if (exact) {
        skipped.push({
          line: row.lineNumber,
          name: row.name,
          reason: `Already in Atlas as ${exact.atlas_id} "${exact.name}" in ${exact.city ?? "—"}, ${exact.state ?? "—"}`,
        });
        continue;
      }

      const sameState = pool.find((f) => f.name_normalized === norm && eq(f.state, row.state));

      const { data: inserted, error: insertError } = await supabase
        .from("facilities")
        .insert({
          name: row.name,
          street_address: row.street_address,
          city: row.city,
          state: row.state,
          zip: row.zip,
          website: row.website,
          maps_link: row.maps_link,
          field_count: row.field_count,
          surface_type: row.surface_type,
          latitude: row.latitude,
          longitude: row.longitude,
          county: row.county,
          indoor: row.indoor,
          lights: row.lights,
          batting_cages: row.batting_cages,
          concessions: row.concessions,
          restrooms: row.restrooms,
          playground: row.playground,
          parking: row.parking,
          data_source: row.data_source,
          description: row.description,
          created_by_organization_id: ctx.organization.id,
        })
        .select("id, atlas_id, name, name_normalized, city, state")
        .single();

      if (insertError) {
        errors.push({ line: row.lineNumber, name: row.name, reason: insertError.message });
        continue;
      }

      addedThisRun.push(inserted);

      const entry = {
        line: row.lineNumber,
        atlasId: inserted.atlas_id,
        name: row.name,
        location: [row.city, row.state].filter(Boolean).join(", "),
        warnings: row.warnings ?? [],
      };

      if (sameState) {
        duplicates.push({
          ...entry,
          reason: `${sameState.atlas_id} "${sameState.name}" already exists in ${sameState.city ?? "—"}, ${sameState.state}. Created anyway — confirm they are different venues.`,
        });
      } else {
        created.push(entry);
      }
    }

    revalidatePath("/facilities");
    return { ok: true, created, skipped, duplicates, errors };
  } catch (e) {
    return { ok: false, error: e.message, created: [], skipped: [], duplicates: [], errors: [] };
  }
}
