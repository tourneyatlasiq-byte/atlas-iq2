"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getContext, isOrgAdmin, VIEW_SEASON_COOKIE } from "../context";

/**
 * Season navigation and creation.
 *
 * Two distinct concepts, deliberately never merged:
 *
 *   viewing   a per-user preference held in a cookie. Changes nothing for
 *             anyone else and never touches is_current.
 *   current   which season the team is actually working in. Admin only,
 *             changed through set_current_season().
 *
 * A coach looking at last year should not have to tell Atlas that last year is
 * now the active season.
 */

// Next 14.2: cookies() is synchronous. Next 15 makes it a promise — if this
// project upgrades, every cookies() call here needs awaiting.
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

/**
 * Changes which season this user is looking at.
 *
 * Validated by membership of the accessible season list rather than by
 * checking the id itself — RLS has already bounded that list, so a tampered
 * cookie cannot reach another organization's data.
 */
export async function viewSeason(seasonId) {
  try {
    const ctx = await getContext();
    if (!ctx.organization) return { ok: false, error: "No organization is linked to this account." };

    const store = cookies();

    if (!seasonId) {
      store.delete(VIEW_SEASON_COOKIE);
      revalidatePath("/", "layout");
      return { ok: true };
    }

    const allowed = ctx.seasons.some((s) => s.id === seasonId);
    if (!allowed) {
      // Not an error worth showing — clear it and fall back to current.
      store.delete(VIEW_SEASON_COOKIE);
      return { ok: false, error: "That season isn't available to you." };
    }

    store.set(VIEW_SEASON_COOKIE, seasonId, COOKIE_OPTIONS);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Returns to the team's current season. */
export async function returnToCurrentSeason() {
  const store = cookies();
  store.delete(VIEW_SEASON_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Creates next season and carries selected people over.
 *
 * Does not make it current — creating a season and advancing the team into it
 * are separate decisions.
 */
export async function startNextSeason(formData) {
  try {
    const ctx = await getContext();
    if (!isOrgAdmin(ctx.profile)) {
      return { ok: false, error: "Only an owner or admin can start a new season." };
    }

    const name = (formData.get("season_name") ?? "").toString().trim();
    if (!name) return { ok: false, error: "Enter a name for the new season." };

    const playerIds = formData.getAll("player_ids").map(String).filter(Boolean);
    const copyBudget = formData.get("copy_budget") === "on";

    const supabase = createClient();
    const { data, error } = await supabase.rpc("start_next_season", {
      p_team_id: ctx.team.id,
      p_season_name: name,
      p_player_ids: playerIds,
      p_copy_budget: copyBudget,
    });

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: `This team already has a season called ${name}.` };
      }
      if (error.code === "42501") {
        return { ok: false, error: "Only an owner or admin can start a new season." };
      }
      console.error("start_next_season failed:", error);
      return { ok: false, error: "We couldn't create that season. Please try again." };
    }

    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { ok: true, result: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Advances the team into a season. Changes what everyone on the team sees, so
 * the interface confirms first.
 */
export async function makeSeasonCurrent(formData) {
  try {
    const ctx = await getContext();
    if (!isOrgAdmin(ctx.profile)) {
      return { ok: false, error: "Only an owner or admin can change the current season." };
    }

    const seasonId = (formData.get("season_id") ?? "").toString().trim();
    if (!seasonId) return { ok: false, error: "Missing season reference." };

    const supabase = createClient();
    const { error } = await supabase.rpc("set_current_season", { p_season_id: seasonId });

    if (error) {
      if (error.code === "42501") {
        return { ok: false, error: "That season isn't one you can make current." };
      }
      console.error("set_current_season failed:", error);
      return { ok: false, error: "We couldn't change the current season. Please try again." };
    }

    // Viewing preference is now redundant — the season they wanted is current.
    const store = cookies();
    store.delete(VIEW_SEASON_COOKIE);

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
