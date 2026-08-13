"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import { normalizeReasons } from "../qab-rules";

/**
 * Plate appearance writes — the single write path for QAB.
 *
 * Both future entry interfaces call these functions. The phone tracker calls
 * recordPlateAppearance once per tap; the desktop grid calls the same function
 * per cell. Neither has its own model, its own table, or its own maths.
 *
 * The durable identity is the client-generated UUID. It is created at the
 * moment of the tap, before any network call, and it never changes. That is
 * what makes a retry safe: the same id replayed from an offline queue conflicts
 * with the row it already wrote and does nothing, rather than creating a second
 * plate appearance and quietly inflating the denominator.
 *
 * The database owns integrity and none of it is reimplemented here:
 *   - is_qab is generated from cardinality(qab_reasons) > 0, so several
 *     reasons on one plate appearance are one quality at bat by construction
 *   - pa_reasons_allowed rejects any key outside the approved eight
 *   - trg_normalize_qab_reasons de-duplicates and sorts server-side
 *   - plate_appearances_natural_key blocks a duplicate live (game, player,
 *     pa_number) even from a second device
 *   - enforce_pa_integrity validates org, season and person_type
 *   - RLS carries the QAB feature gate and season scoping
 */

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) {
    throw new Error("Your role doesn't allow recording plate appearances.");
  }
  return ctx;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendly(error) {
  if (!error) return "Something went wrong. Try again.";
  if (error.code === "23505") {
    return "That batter already has a plate appearance in this slot. Reload to see the current entries.";
  }
  if (error.code === "23514") {
    return error.message.replace(/^.*?ERROR:\s*/i, "");
  }
  if (error.code === "42501" || error.message?.includes("row-level security")) {
    return "Quality At Bat isn't available for this organization.";
  }
  if (error.code === "23503") {
    return "That game or player could not be found.";
  }
  return error.message?.replace(/^.*?ERROR:\s*/i, "") ?? "Something went wrong. Try again.";
}

/** Scoping values come from the game row, never from the browser. */
async function gameScope(supabase, gameId) {
  const { data, error } = await supabase
    .from("games")
    .select("id, organization_id, season_id")
    .eq("id", gameId)
    .maybeSingle();

  if (error) throw new Error(friendly(error));
  if (!data) throw new Error("That game could not be found.");
  return data;
}

/**
 * Records one plate appearance.
 *
 * `id` must be supplied by the caller. There is deliberately no server-side
 * fallback: a missing id is a bug in the caller, and generating one here would
 * silently destroy the retry guarantee at exactly the moment it matters.
 *
 * `reasons` may be empty. An explicit non-QAB is a real plate appearance and
 * gets a real row — it belongs in the PA denominator, and inferring it from
 * missing data is the failure this whole model exists to avoid.
 *
 * Idempotent: a replayed id returns ok with `duplicate: true` rather than an
 * error, so an offline queue can treat it as delivered and drop it.
 */
export async function recordPlateAppearance({
  id,
  gameId,
  playerId,
  paNumber,
  inning = null,
  reasons = [],
  notes = null,
}) {
  try {
    await guard();
    const supabase = createClient();

    if (!id || !UUID_RE.test(id)) {
      return { ok: false, error: "Missing or malformed plate appearance id." };
    }
    if (!gameId || !playerId) return { ok: false, error: "Missing game or player reference." };
    if (!Number.isInteger(paNumber) || paNumber < 1 || paNumber > 20) {
      return { ok: false, error: "That plate appearance number is out of range." };
    }

    const scope = await gameScope(supabase, gameId);

    const { data, error } = await supabase
      .from("plate_appearances")
      .upsert(
        {
          id,
          organization_id: scope.organization_id,
          season_id: scope.season_id,
          game_id: gameId,
          player_id: playerId,
          pa_number: paNumber,
          inning,
          qab_reasons: normalizeReasons(reasons),
          notes,
          // recorded_by is deliberately omitted. enforce_pa_integrity fills it
          // from auth.uid(); sending it would let a caller attribute an entry
          // to someone else.
        },
        { onConflict: "id", ignoreDuplicates: true }
      )
      .select("id, pa_number, qab_reasons, is_qab, updated_at");

    if (error) return { ok: false, error: friendly(error) };

    // ignoreDuplicates returns no row when the id already existed.
    if (!data || data.length === 0) {
      return { ok: true, duplicate: true, id, notice: null };
    }

    revalidatePath("/tournaments");
    return { ok: true, duplicate: false, id, pa: data[0] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Corrects an existing plate appearance in place.
 *
 * Editing never creates a second row — the id is the plate appearance, and a
 * correction changes what was recorded about it. Reasons are replaced wholesale
 * rather than merged, because the caller always holds the complete set of
 * toggles for that batter.
 *
 * `expectedUpdatedAt` is an optional optimistic-concurrency token. When
 * supplied, the update only matches if the row has not changed since it was
 * read, so a stale phone replaying a queued correction over a newer desktop
 * edit is rejected instead of silently winning.
 */
export async function correctPlateAppearance({
  id,
  reasons,
  inning,
  notes,
  expectedUpdatedAt = null,
}) {
  try {
    await guard();
    const supabase = createClient();

    if (!id || !UUID_RE.test(id)) {
      return { ok: false, error: "Missing or malformed plate appearance id." };
    }

    const fields = {};
    if (reasons !== undefined) fields.qab_reasons = normalizeReasons(reasons);
    if (inning !== undefined) fields.inning = inning;
    if (notes !== undefined) fields.notes = notes;
    if (Object.keys(fields).length === 0) return { ok: true, notice: null };

    let q = supabase.from("plate_appearances").update(fields).eq("id", id);
    if (expectedUpdatedAt) q = q.eq("updated_at", expectedUpdatedAt);

    const { data, error } = await q.select("id, qab_reasons, is_qab, updated_at");
    if (error) return { ok: false, error: friendly(error) };

    if (!data || data.length === 0) {
      return {
        ok: false,
        stale: true,
        error: "That plate appearance changed somewhere else. Reload to see the current entry.",
      };
    }

    revalidatePath("/tournaments");
    return { ok: true, pa: data[0], notice: "Plate appearance updated." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Undo — voids a plate appearance rather than deleting it.
 *
 * The deployed schema is built for this: voided_at/voided_by exist, every
 * qab_* view filters `where voided_at is null`, and the natural-key unique
 * index is partial on the same condition. So a void removes the row from every
 * count while leaving the record, and it frees that (game, player, pa_number)
 * slot for re-entry — which is what undo-then-re-record needs.
 *
 * Deleting instead would destroy the correction history and, once QAB spans a
 * season, remove the only evidence of what a tracker actually entered.
 *
 * Idempotent: voiding an already-voided row is a no-op that reports success,
 * so a queued undo replayed after reconnect does not error.
 */
export async function voidPlateAppearance({ id, expectedUpdatedAt = null }) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    if (!id || !UUID_RE.test(id)) {
      return { ok: false, error: "Missing or malformed plate appearance id." };
    }

    let q = supabase
      .from("plate_appearances")
      .update({ voided_at: new Date().toISOString(), voided_by: ctx.profile.id })
      .eq("id", id)
      .is("voided_at", null);

    if (expectedUpdatedAt) q = q.eq("updated_at", expectedUpdatedAt);

    const { data, error } = await q.select("id, voided_at");
    if (error) return { ok: false, error: friendly(error) };

    if (!data || data.length === 0) {
      const { data: existing } = await supabase
        .from("plate_appearances")
        .select("id, voided_at")
        .eq("id", id)
        .maybeSingle();

      if (existing?.voided_at) return { ok: true, alreadyVoided: true, id };
      if (!existing) return { ok: false, error: "That plate appearance no longer exists." };
      return {
        ok: false,
        stale: true,
        error: "That plate appearance changed somewhere else. Reload to see the current entry.",
      };
    }

    revalidatePath("/tournaments");
    return { ok: true, id, notice: "Plate appearance removed." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Restores a voided plate appearance.
 *
 * Undoing an undo. Can fail legitimately: if the batter's number was reused
 * after the void, restoring would create a duplicate live (game, player,
 * pa_number) and the unique index rejects it. That is the correct outcome and
 * the message says what to do.
 */
export async function restorePlateAppearance({ id }) {
  try {
    await guard();
    const supabase = createClient();

    if (!id || !UUID_RE.test(id)) {
      return { ok: false, error: "Missing or malformed plate appearance id." };
    }

    const { data, error } = await supabase
      .from("plate_appearances")
      .update({ voided_at: null, voided_by: null })
      .eq("id", id)
      .not("voided_at", "is", null)
      .select("id");

    if (error) {
      if (error.code === "23505") {
        return {
          ok: false,
          error: "That slot has been used again since. Correct the current entry instead.",
        };
      }
      return { ok: false, error: friendly(error) };
    }

    if (!data || data.length === 0) return { ok: true, alreadyLive: true, id };

    revalidatePath("/tournaments");
    return { ok: true, id, notice: "Plate appearance restored." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
