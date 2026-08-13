"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";

/**
 * QAB batting order writes.
 *
 * The database owns integrity here and this layer does not re-implement it:
 * game_lineup_slots carries UNIQUE (game_id, batting_order) and
 * UNIQUE (game_id, player_id), so a duplicate slot or a duplicate player is
 * rejected at the constraint even if a double-tap or a stale tab gets past the
 * UI. The QAB feature gate and season scoping live in the RLS policies. What
 * this file adds is a whole-order replacement that keeps numbering contiguous,
 * and error text a coach can act on.
 */

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to lineups.");
  return ctx;
}

function friendly(error) {
  if (!error) return "Something went wrong. Try again.";
  if (error.code === "23505") {
    return "That lineup has a duplicate player or slot. Reload the page and try again.";
  }
  if (error.code === "42501" || error.message?.includes("row-level security")) {
    return "Lineups aren't available for this organization.";
  }
  return error.message?.replace(/^.*?ERROR:\s*/i, "") ?? "Something went wrong. Try again.";
}

/** The game's own scoping values, so nothing is trusted from the browser. */
async function gameScope(supabase, gameId) {
  const { data, error } = await supabase
    .from("games")
    .select("id, organization_id, season_id, tournament_id")
    .eq("id", gameId)
    .maybeSingle();

  if (error) throw new Error(friendly(error));
  if (!data) throw new Error("That game could not be found.");
  return data;
}

/**
 * Replaces the entire batting order for one game.
 *
 * Delete-then-insert rather than a diff. The order is small, it is edited as a
 * whole, and a positional diff would have to shuffle rows through the
 * UNIQUE (game_id, batting_order) constraint mid-update — moving a batter from
 * slot 3 to slot 1 collides with whoever holds slot 1 until they move. A full
 * replacement sidesteps the ordering problem entirely.
 *
 * playerIds arrives in batting order. Slot numbers are assigned from that
 * position, so the result is always contiguous from 1 regardless of what the
 * client sent.
 */
export async function saveLineup(gameId, playerIds) {
  try {
    await guard();
    const supabase = createClient();

    if (!gameId) return { ok: false, error: "Missing game reference." };

    const ids = [...new Set((playerIds ?? []).filter(Boolean))];
    if (ids.length !== (playerIds ?? []).length) {
      return { ok: false, error: "A player appears twice in that order. Remove the duplicate." };
    }

    const scope = await gameScope(supabase, gameId);

    const { error: delErr } = await supabase
      .from("game_lineup_slots")
      .delete()
      .eq("game_id", gameId);
    if (delErr) return { ok: false, error: friendly(delErr) };

    if (ids.length > 0) {
      const rows = ids.map((player_id, i) => ({
        organization_id: scope.organization_id,
        season_id: scope.season_id,
        game_id: gameId,
        player_id,
        batting_order: i + 1,
      }));

      const { error: insErr } = await supabase.from("game_lineup_slots").insert(rows);
      if (insErr) return { ok: false, error: friendly(insErr) };
    }

    revalidatePath("/tournaments");
    return {
      ok: true,
      notice: ids.length === 0 ? "Lineup cleared." : `Lineup saved — ${ids.length} batters.`,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Copies the most recent earlier lineup in this season, on request only.
 *
 * copy_previous_lineup() is SECURITY INVOKER, so it runs under the caller's
 * RLS and the feature gate applies unchanged. It returns 0 when no earlier
 * game has a lineup — a normal answer, not a failure, and reported as such.
 *
 * The function skips archived players, which can leave a gap in the copied
 * numbering: if the source had an archived batter in slot 5, the copy runs
 * 1,2,3,4,6. We renumber immediately so the order the user sees is contiguous,
 * which is also what every downstream QAB reader expects.
 */
export async function copyPreviousLineup(gameId) {
  try {
    await guard();
    const supabase = createClient();

    if (!gameId) return { ok: false, error: "Missing game reference." };

    const scope = await gameScope(supabase, gameId);

    const { data: copied, error } = await supabase.rpc("copy_previous_lineup", {
      p_game_id: gameId,
    });

    if (error) return { ok: false, error: friendly(error) };

    if (!copied || copied === 0) {
      return {
        ok: true,
        copied: 0,
        notice: "No earlier game in this season has a lineup yet. Build this one by tapping players.",
      };
    }

    const { data: slots } = await supabase
      .from("game_lineup_slots")
      .select("id, batting_order")
      .eq("game_id", gameId)
      .order("batting_order");

    const needsRenumber = (slots ?? []).some((s, i) => s.batting_order !== i + 1);
    if (needsRenumber) {
      const { data: ordered } = await supabase
        .from("game_lineup_slots")
        .select("player_id, batting_order")
        .eq("game_id", gameId)
        .order("batting_order");

      await supabase.from("game_lineup_slots").delete().eq("game_id", gameId);
      await supabase.from("game_lineup_slots").insert(
        (ordered ?? []).map((s, i) => ({
          organization_id: scope.organization_id,
          season_id: scope.season_id,
          game_id: gameId,
          player_id: s.player_id,
          batting_order: i + 1,
        }))
      );
    }

    // Return the copied order with this tournament's display data so the page
    // can show it immediately without a reload. Jersey and participation are
    // resolved from THIS tournament's participants — a pickup who wore #23 at
    // the previous event does not carry that number forward.
    const { data: finalSlots } = await supabase
      .from("game_lineup_slots")
      .select("player_id, batting_order, player:players ( id, full_name )")
      .eq("game_id", gameId)
      .order("batting_order");

    const { data: participants } = await supabase
      .from("tournament_participants")
      .select("player_id, jersey_number, participation")
      .eq("tournament_id", scope.tournament_id);

    const meta = new Map(
      (participants ?? []).map((p) => [p.player_id, p])
    );

    const order = (finalSlots ?? []).map((s) => ({
      player_id: s.player_id,
      full_name: s.player?.full_name ?? "Unknown player",
      jersey_number: meta.get(s.player_id)?.jersey_number ?? null,
      participation: meta.get(s.player_id)?.participation ?? null,
      batting_order: s.batting_order,
    }));

    revalidatePath("/tournaments");
    return {
      ok: true,
      copied,
      order,
      notice: `Copied ${copied} batters. Make any changes, then save.`,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
