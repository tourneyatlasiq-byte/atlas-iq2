"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";

/**
 * Game writes.
 *
 * The database trigger enforce_game_result_timing() is the real boundary:
 * it blocks results on future-dated games, rejects half-entered scores, and
 * derives result from the score so a 'W' can never sit beside a losing
 * scoreline. Nothing here re-implements those rules — this layer exists to
 * turn a trigger exception into a message a coach can act on.
 */

export const GAME_TYPES = ["Pool", "Bracket", "Championship", "Friendly", "Scrimmage"];

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

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to games.");
  return ctx;
}

/** Trigger errors carry the useful text already; surface it rather than a generic failure. */
function friendly(error) {
  if (error?.code === "23514" || error?.message?.includes("cannot have a result")) {
    return error.message.replace(/^.*?ERROR:\s*/i, "");
  }
  return error?.message ?? "Something went wrong. Try again.";
}

function fieldsFrom(formData) {
  const runsFor = int(formData.get("runs_for"));
  const runsAgainst = int(formData.get("runs_against"));

  return {
    game_date: text(formData.get("game_date")),
    start_time: text(formData.get("start_time")),
    opponent_name: text(formData.get("opponent_name")),
    game_type: text(formData.get("game_type")),
    runs_for: runsFor,
    runs_against: runsAgainst,
    // Only meaningful when no score is entered; the trigger overwrites it
    // whenever both scores are present.
    result: runsFor != null && runsAgainst != null ? null : text(formData.get("result")),
    notes: text(formData.get("notes")),
  };
}

export async function saveGame(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const tournamentId = text(formData.get("tournament_id"));
    if (!tournamentId) return { ok: false, error: "A game must belong to a tournament." };

    const fields = fieldsFrom(formData);
    if (!fields.game_date) return { ok: false, error: "Enter a date." };
    if (!fields.opponent_name) return { ok: false, error: "Enter an opponent." };

    const id = text(formData.get("id"));

    const { error } = id
      ? await supabase.from("games").update(fields).eq("id", id)
      : await supabase.from("games").insert({
          ...fields,
          tournament_id: tournamentId,
          organization_id: ctx.organization.id,
          season_id: ctx.season.id,
        });

    if (error) return { ok: false, error: friendly(error) };

    revalidatePath("/tournaments");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deleteGame(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase.from("games").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/tournaments");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
