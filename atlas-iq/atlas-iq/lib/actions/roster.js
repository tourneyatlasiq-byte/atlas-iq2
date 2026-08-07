"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";

/**
 * Roster writes.
 *
 * Each action resolves context server-side, writes under the caller's RLS
 * context, then revalidates. Revalidation is what makes a saved change
 * survive a hard refresh — the mutation and the next read share a request.
 *
 * Actions return { ok } or { ok:false, error } rather than throwing, so the
 * UI can surface a message instead of an error boundary.
 */

function text(v) {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function int(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) {
    throw new Error("Your role doesn't allow changes to the roster.");
  }
  return ctx;
}

/** Creates a player in the organization and assigns them to the current season. */
export async function addRosterMember(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const fullName = text(formData.get("full_name"));
    if (!fullName) return { ok: false, error: "Enter a name." };

    const { data: player, error: playerError } = await supabase
      .from("players")
      .insert({
        organization_id: ctx.organization.id,
        full_name: fullName,
        person_type: text(formData.get("person_type")) ?? "player",
        grad_year: int(formData.get("grad_year")),
        date_of_birth: text(formData.get("date_of_birth")),
        parent_email: text(formData.get("parent_email")),
        parent_phone: text(formData.get("parent_phone")),
      })
      .select("id")
      .single();

    if (playerError) return { ok: false, error: playerError.message };

    const { error: assignError } = await supabase.from("team_season_players").insert({
      player_id: player.id,
      team_id: ctx.team.id,
      season_id: ctx.season.id,
      jersey_number: int(formData.get("jersey_number")),
      jersey_size: text(formData.get("jersey_size")),
      pants_size: text(formData.get("pants_size")),
      position: text(formData.get("position")),
    });

    if (assignError) {
      // Don't leave an orphaned player behind if the assignment fails.
      await supabase.from("players").delete().eq("id", player.id);
      return { ok: false, error: assignError.message };
    }

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Updates both the player record and their season assignment. */
export async function updateRosterMember(formData) {
  try {
    await guard();
    const supabase = createClient();

    const assignmentId = formData.get("assignment_id");
    const playerId = formData.get("player_id");
    if (!assignmentId || !playerId) return { ok: false, error: "Missing record reference." };

    const fullName = text(formData.get("full_name"));
    if (!fullName) return { ok: false, error: "Enter a name." };

    const { error: playerError } = await supabase
      .from("players")
      .update({
        full_name: fullName,
        person_type: text(formData.get("person_type")) ?? "player",
        grad_year: int(formData.get("grad_year")),
        date_of_birth: text(formData.get("date_of_birth")),
        parent_email: text(formData.get("parent_email")),
        parent_phone: text(formData.get("parent_phone")),
      })
      .eq("id", playerId);

    if (playerError) return { ok: false, error: playerError.message };

    const { error: assignError } = await supabase
      .from("team_season_players")
      .update({
        jersey_number: int(formData.get("jersey_number")),
        jersey_size: text(formData.get("jersey_size")),
        pants_size: text(formData.get("pants_size")),
        position: text(formData.get("position")),
      })
      .eq("id", assignmentId);

    if (assignError) return { ok: false, error: assignError.message };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Removes the season assignment. The player record is kept, since they may
 * have history in other seasons — removing someone from this year's roster
 * is not the same as deleting them from the organization.
 */
export async function removeRosterMember(formData) {
  try {
    await guard();
    const supabase = createClient();

    const assignmentId = formData.get("assignment_id");
    if (!assignmentId) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase
      .from("team_season_players")
      .delete()
      .eq("id", assignmentId);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
