"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";

/**
 * Event roster actions.
 *
 * The database enforces every invariant through enforce_participant_integrity().
 * These actions exist to derive values the client must not supply, and to turn
 * integrity failures into something a coach can act on.
 */

/**
 * Plain language for the trigger's messages.
 *
 * A raw Postgres error tells a coach nothing and looks like a crash. Matched on
 * the message the trigger raises, with a generic fallback so a new rule never
 * surfaces as a stack trace.
 */
function friendly(error, context = {}) {
  const m = (error?.message ?? "").toLowerCase();

  if (m.includes("already on this season's roster")) {
    return `${context.name ?? "That player"} is already on your ${context.season ?? "season"} roster, so they can't be added as a pickup. Add them from the roster list instead.`;
  }
  if (m.includes("not on this season's roster")) {
    return `${context.name ?? "That player"} isn't on your season roster. Add them as a pickup instead.`;
  }
  if (m.includes("different organization")) {
    return "That player isn't part of your organization.";
  }
  if (m.includes("read-only") || m.includes("finished")) {
    return "That season has finished, so its tournament roster can't be changed.";
  }
  if (error?.code === "23505" || m.includes("duplicate key")) {
    return `${context.name ?? "That player"} is already on this tournament roster.`;
  }
  if (m.includes("does not match")) {
    return "Something didn't line up with this tournament. Please reload and try again.";
  }
  if (m.includes("could not be found")) {
    return "That tournament or player could not be found.";
  }

  console.error("participant action failed:", error);
  return "We couldn't update the tournament roster. Please try again.";
}

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) {
    throw new Error("Your role doesn't allow changes to the tournament roster.");
  }
  return ctx;
}

/** Verifies the tournament belongs to this season before anything is written. */
async function tournamentInSeason(supabase, tournamentId, seasonId) {
  const { data } = await supabase
    .from("tournaments")
    .select("id, name, season_id")
    .eq("id", tournamentId)
    .maybeSingle();

  if (!data || data.season_id !== seasonId) return null;
  return data;
}

/**
 * Replaces the event roster for a tournament with the supplied set.
 *
 * Sent as the complete list rather than individual adds, because that is how
 * the coach thinks about it — "here is who's dressing" — and it keeps the
 * modal's state and the database in step.
 */
export async function setEventRoster(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const tournamentId = (formData.get("tournament_id") ?? "").toString();
    const tournament = await tournamentInSeason(supabase, tournamentId, ctx.season.id);
    if (!tournament) return { ok: false, error: "That tournament isn't in the season you're viewing." };

    // Each entry: playerId|participation|jersey|positions
    const entries = formData.getAll("participant").map(String).filter(Boolean);

    const parsed = entries.map((raw) => {
      const [playerId, participation, jersey, positions] = raw.split("|");
      return {
        organization_id: ctx.organization.id,
        season_id: ctx.season.id,
        tournament_id: tournamentId,
        player_id: playerId,
        participation: participation === "pickup" ? "pickup" : "roster",
        jersey_number: jersey ? Number(jersey) : null,
        positions: positions ? positions.split(",").filter(Boolean) : null,
      };
    });

    // Existing pickups are preserved: they are added one at a time through the
    // pickup flow and are not represented in the roster checkbox list.
    const { data: existing } = await supabase
      .from("tournament_participants")
      .select("id, player_id, participation")
      .eq("tournament_id", tournamentId);

    const keep = new Set(parsed.map((p) => p.player_id));
    const toRemove = (existing ?? [])
      .filter((e) => e.participation === "roster" && !keep.has(e.player_id))
      .map((e) => e.id);

    if (toRemove.length) {
      const { error } = await supabase.from("tournament_participants").delete().in("id", toRemove);
      if (error) return { ok: false, error: friendly(error) };
    }

    const known = new Set((existing ?? []).map((e) => e.player_id));
    const toAdd = parsed.filter((p) => !known.has(p.player_id));

    if (toAdd.length) {
      const { error } = await supabase.from("tournament_participants").insert(toAdd);
      if (error) return { ok: false, error: friendly(error, { season: ctx.season.name }) };
    }

    // Jersey and positions may change for an event without touching the season
    // roster — that separation is the point of the table.
    for (const p of parsed.filter((x) => known.has(x.player_id))) {
      await supabase
        .from("tournament_participants")
        .update({ jersey_number: p.jersey_number, positions: p.positions })
        .eq("tournament_id", tournamentId)
        .eq("player_id", p.player_id);
    }

    revalidatePath("/tournaments");
    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Adds one pickup, reusing an existing player when given, creating a minimal
 * record only when there is genuinely no match.
 */
export async function addPickup(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const tournamentId = (formData.get("tournament_id") ?? "").toString();
    const tournament = await tournamentInSeason(supabase, tournamentId, ctx.season.id);
    if (!tournament) return { ok: false, error: "That tournament isn't in the season you're viewing." };

    let playerId = (formData.get("player_id") ?? "").toString().trim() || null;
    const fullName = (formData.get("full_name") ?? "").toString().trim();
    const gradYear = (formData.get("grad_year") ?? "").toString().trim();
    const jersey = (formData.get("jersey_number") ?? "").toString().trim();
    const positions = formData.getAll("positions").map(String).filter(Boolean);

    if (!playerId) {
      if (!fullName) return { ok: false, error: "Enter the player's name." };

      // Minimum viable person. Everything else can come later — requiring full
      // contact and uniform data to note who pitched on Saturday is friction
      // with no purpose.
      const { data: created, error: createError } = await supabase
        .from("players")
        .insert({
          organization_id: ctx.organization.id,
          full_name: fullName,
          person_type: "player",
          grad_year: gradYear ? Number(gradYear) : null,
        })
        .select("id")
        .single();

      if (createError) return { ok: false, error: friendly(createError, { name: fullName }) };
      playerId = created.id;
    }

    const { error } = await supabase.from("tournament_participants").insert({
      organization_id: ctx.organization.id,
      season_id: ctx.season.id,
      tournament_id: tournamentId,
      player_id: playerId,
      participation: "pickup",
      jersey_number: jersey ? Number(jersey) : null,
      positions: positions.length ? positions : null,
    });

    if (error) {
      return { ok: false, error: friendly(error, { name: fullName || "That player", season: ctx.season.name }) };
    }

    revalidatePath("/tournaments");
    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Removes one participant. The persistent player is never touched. */
export async function removeParticipant(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = (formData.get("id") ?? "").toString();
    if (!id) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase.from("tournament_participants").delete().eq("id", id);
    if (error) return { ok: false, error: friendly(error) };

    revalidatePath("/tournaments");
    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Promotes a pickup onto the season roster.
 *
 * Creates only the assignment — the same persistent player, so every document,
 * statistic and past appearance stays attached.
 */
export async function addPickupToRoster(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const playerId = (formData.get("player_id") ?? "").toString();
    if (!playerId) return { ok: false, error: "Missing player reference." };

    const { data: player } = await supabase
      .from("players")
      .select("id, organization_id, full_name")
      .eq("id", playerId)
      .maybeSingle();

    if (!player || player.organization_id !== ctx.organization.id) {
      return { ok: false, error: "That player isn't part of your organization." };
    }

    const { error } = await supabase.from("team_season_players").insert({
      player_id: playerId,
      team_id: ctx.team.id,
      season_id: ctx.season.id,
      is_active: true,
    });

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: `${player.full_name} is already on this season's roster.` };
      }
      return { ok: false, error: friendly(error, { name: player.full_name }) };
    }

    revalidatePath("/team");
    revalidatePath("/tournaments");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
