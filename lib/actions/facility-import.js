"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import { normalizeName, tokensOverlap, normalizeAddress } from "../facility-import";

/**
 * Facility import.
 *
 * Facilities are canonical shared Atlas records, so an import must be safely
 * rerunnable — running the same CSV twice creates nothing the second time.
 *
 * Matching, in order:
 *
 *   1. Exact normalized name + city + state
 *      -> SKIP. Already in Atlas.
 *
 *   2. Same city + state, and either the word sets are a subset of one another
 *      or the street addresses match
 *      -> NOT CREATED, reported as a potential duplicate for review.
 *
 *      Substring matching is insufficient here. "Al Bishop Complex" is not a
 *      substring of "Al Bishop Softball Complex", nor "Heritage Point Park" of
 *      "Heritage Point Regional Park" — both are genuine duplicates in the
 *      Georgia batch. Comparing word sets catches them.
 *
 *      These are held back rather than created because facilities are canonical
 *      and shared, there is no merge tooling, and a duplicate pollutes the
 *      record for every organization. Adding one manually afterwards is cheap;
 *      unpicking a bad merge is not.
 *
 *   3. Same normalized name, same state, DIFFERENT city
 *      -> CREATE, flagged. Two towns in one state can legitimately both have a
 *         "Riverside Park", so this is a note rather than a block.
 *
 *   4. No match -> CREATE.
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
      .select("id, atlas_id, name, name_normalized, city, state, street_address");

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

      const sameCity = pool.filter((f) => eq(f.city, row.city) && eq(f.state, row.state));

      const exact = sameCity.find((f) => f.name_normalized === norm);
      if (exact) {
        skipped.push({
          line: row.lineNumber,
          atlasId: exact.atlas_id,
          name: row.name,
          reason: `Already in Atlas as ${exact.atlas_id} "${exact.name}"`,
        });
        continue;
      }

      // Same town, near-identical name or matching address: almost certainly
      // the same venue. Held back for review rather than created.
      const rowAddress = normalizeAddress(row.street_address);
      const near = sameCity.find(
        (f) =>
          tokensOverlap(f.name, row.name) ||
          (rowAddress && normalizeAddress(f.street_address) === rowAddress)
      );

      if (near) {
        duplicates.push({
          line: row.lineNumber,
          atlasId: near.atlas_id,
          name: row.name,
          location: [row.city, row.state].filter(Boolean).join(", "),
          reason: `Looks like ${near.atlas_id} "${near.name}" in the same city. Not created — add it manually if it is genuinely a different venue.`,
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
        created.push({
          ...entry,
          warnings: [
            ...entry.warnings,
            `same name as ${sameState.atlas_id} in ${sameState.city ?? "—"} — different city, so created`,
          ],
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
