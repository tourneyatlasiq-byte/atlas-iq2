"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";

/**
 * Tournament writes. Same pattern proven in the Team slice: resolve context,
 * write under the caller's RLS context, revalidate so a hard refresh shows
 * the saved state.
 *
 * total_cost is a generated column (entry_fee + gate_fee) and is never written.
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

function tri(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  return s === "true";
}

function money(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to tournaments.");
  return ctx;
}

function fieldsFrom(formData) {
  return {
    name: text(formData.get("name")),
    tournament_provider_id: text(formData.get("tournament_provider_id")),
    facility_id: text(formData.get("facility_id")),
    start_date: text(formData.get("start_date")),
    end_date: text(formData.get("end_date")),
    location: text(formData.get("location")),
    entry_fee: money(formData.get("entry_fee")),
    gate_fee: money(formData.get("gate_fee")),
    travel_type: text(formData.get("travel_type")),
    decision: text(formData.get("decision")) ?? "Considering",
    paid_status: text(formData.get("paid_status")) ?? "Not Registered",
    placement: text(formData.get("placement")),
    event_url: text(formData.get("event_url")),
    notes: text(formData.get("notes")),
    age_division: text(formData.get("age_division")),
    tournament_type: text(formData.get("tournament_type")),
    guaranteed_games: int(formData.get("guaranteed_games")),
    registration_deadline: text(formData.get("registration_deadline")),
    would_play_again: tri(formData.get("would_play_again")),
    overall_rating: int(formData.get("overall_rating")),
    history_notes: text(formData.get("history_notes")),
  };
}

/** Capture an option quickly. Only name and start date are required. */
export async function addTournament(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const fields = fieldsFrom(formData);
    if (!fields.name) return { ok: false, error: "Enter a tournament name." };
    if (!fields.start_date) return { ok: false, error: "Enter a start date." };

    const { data: created, error } = await supabase
      .from("tournaments")
      .insert({
        ...fields,
        organization_id: ctx.organization.id,
        season_id: ctx.season.id,
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true, id: created?.id ?? null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function updateTournament(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const fields = fieldsFrom(formData);
    if (!fields.name) return { ok: false, error: "Enter a tournament name." };
    if (!fields.start_date) return { ok: false, error: "Enter a start date." };

    const { error } = await supabase.from("tournaments").update(fields).eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Fast inline status change — the action a coach takes most often, so it
 * doesn't cost a modal. Used for both decision and payment status.
 */
export async function setTournamentStatus(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    const field = formData.get("field");
    const value = text(formData.get("value"));

    if (!id) return { ok: false, error: "Missing record reference." };
    if (field !== "decision" && field !== "paid_status") {
      return { ok: false, error: "That field can't be changed this way." };
    }

    const { error } = await supabase.from("tournaments").update({ [field]: value }).eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Reserved for genuine mistakes. Declined is the archive state. */
export async function deleteTournament(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const { count } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", id);

    if (count && count > 0) {
      return {
        ok: false,
        error: `This tournament has ${count} game${count === 1 ? "" : "s"} logged against it. Mark it Declined instead of deleting.`,
      };
    }

    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


/** Links a tournament to the budget line its costs count against. */
export async function setTournamentBudgetLine(formData) {
  try {
    await guard();
    const supabase = createClient();

    const tournamentId = text(formData.get("tournament_id"));
    if (!tournamentId) return { ok: false, error: "Missing tournament reference." };

    const { error } = await supabase
      .from("tournaments")
      .update({ budget_item_id: text(formData.get("budget_item_id")) })
      .eq("id", tournamentId);

    if (error) {
      const m = (error.message ?? "").toLowerCase();
      if (m.includes("expense budget line")) {
        return { ok: false, error: "Tournament costs belong to an expense budget line." };
      }
      if (m.includes("different season")) {
        return { ok: false, error: "That budget line belongs to a different season." };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
