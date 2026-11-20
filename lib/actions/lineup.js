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
 *
 * Save and Copy go through replace_game_lineup(), one database transaction, so
 * a failure leaves the previous lineup in place. There is deliberately NO
 * fallback to a delete-then-insert if that function is missing: that two-step
 * write is the bug it replaced. Once a game has recorded at-bats, the database
 * (guard_lineup_slots) refuses reordering, removing or clearing slots whatever
 * calls it; this file only words the refusal.
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
  // replace_game_lineup not installed yet (app deployed before the migration).
  if (error.code === "PGRST202" || error.code === "42883") {
    return "Saving lineups is being updated and isn't available right now. Try again in a few minutes.";
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
/**
 * Player ids that may legitimately bat in this game.
 *
 * THE UNION of the tournament's participants and the season's active roster.
 * Not one or the other, because the product already treats them differently
 * in two places and both must keep working:
 *
 *   Lineup setup  uses tournament participants when the tournament has any,
 *                 and falls back to the active season roster when it does not.
 *   Substitution  draws from the union, so a coach can bring in someone who
 *                 was not listed for the tournament when a player rolls an
 *                 ankle mid-game.
 *
 * The union is a superset of both, so this can never reject a player the UI
 * offered — including a legitimate pickup who has a tournament_participants
 * row but no team_season_players row.
 *
 * Cross-tenant safety falls out of the reads: both queries run through the
 * caller's RLS-scoped client, so a player belonging to another organization
 * simply never appears in either result and is rejected. That is enforcement,
 * not a UI filter — the same rejection applies to a request crafted by hand.
 *
 * Coaches, staff and archived players are excluded: season fees and batting
 * orders are for active players.
 */
async function eligiblePlayerIds(supabase, scope) {
  const [participants, roster] = await Promise.all([
    scope.tournament_id
      ? supabase
          .from("tournament_participants")
          .select("player_id, player:players ( id, person_type, archived_at )")
          .eq("tournament_id", scope.tournament_id)
      : Promise.resolve({ data: [] }),
    supabase
      .from("team_season_players")
      .select("player_id, is_active, player:players ( id, person_type, archived_at )")
      .eq("season_id", scope.season_id),
  ]);

  const usable = (r) =>
    r.player && r.player.person_type === "player" && !r.player.archived_at && r.player_id;

  const ids = new Set();
  for (const r of participants.data ?? []) if (usable(r)) ids.add(r.player_id);
  for (const r of roster.data ?? []) if (usable(r) && r.is_active !== false) ids.add(r.player_id);
  return ids;
}

async function currentCount(supabase, gameId) {
  const { data } = await supabase.from("game_lineup_slots").select("id").eq("game_id", gameId);
  return (data ?? []).length;
}

/** True once the game has a recorded (non-voided) plate appearance. */
async function isTracked(supabase, gameId) {
  const { data } = await supabase
    .from("plate_appearances")
    .select("id")
    .eq("game_id", gameId)
    .is("voided_at", null)
    .limit(1);
  return (data ?? []).length > 0;
}

export async function saveLineup(gameId, playerIds, opts = {}) {
  try {
    await guard();
    const supabase = createClient();

    if (!gameId) return { ok: false, error: "Missing game reference." };

    const ids = [...new Set((playerIds ?? []).filter(Boolean))];
    if (ids.length !== (playerIds ?? []).length) {
      return { ok: false, error: "A player appears twice in that order. Remove the duplicate." };
    }

    const scope = await gameScope(supabase, gameId);

    /* Validated server-side, never trusted from the request. Rejects a player
       from another organization, another season, or an arbitrary UUID — the
       eligibility set is built from RLS-scoped reads, so a foreign id cannot
       be in it. Checked BEFORE the delete, so a rejected submission leaves the
       existing lineup untouched. */
    if (ids.length > 0) {
      const eligible = await eligiblePlayerIds(supabase, scope);
      const rejected = ids.filter((id) => !eligible.has(id));
      if (rejected.length > 0) {
        return {
          ok: false,
          error:
            rejected.length === 1
              ? "One of those players isn't on this team's roster or tournament roster."
              : `${rejected.length} of those players aren't on this team's roster or tournament roster.`,
        };
      }
    }

    // One transaction: replaces the order, or (in a tracked game) appends late
    // arrivals only. A failure here leaves the previous lineup untouched.
    const before = await currentCount(supabase, gameId);

    // A tracked game with NO saved order (at-bats exist, slots do not) is a
    // rebuild, never an ordinary late arrival: the new slots must line up with
    // slot numbers already recorded on the at-bats. It is only done when the
    // caller says so explicitly, so a stale page cannot do it by accident.
    const rebuild = ids.length > 0 && before === 0 && (await isTracked(supabase, gameId));
    if (rebuild && opts?.rebuild !== true) {
      return {
        ok: false,
        code: "needsRebuildConfirm",
        error:
          "This game has recorded at-bats but no batting order. Rebuilding it needs confirmation, because each slot must match the player who batted there. Reload the lineup page to rebuild it.",
      };
    }

    const { error: rpcErr } = await supabase.rpc("replace_game_lineup", {
      p_game_id: gameId,
      p_player_ids: ids,
    });
    if (rpcErr) return { ok: false, error: friendly(rpcErr) };
    const added = Math.max(0, ids.length - before);

    revalidatePath("/tournaments");
    return {
      ok: true,
      added,
      rebuilt: rebuild,
      notice:
        ids.length === 0
          ? "Lineup cleared."
          : rebuild
            ? `Batting order rebuilt with ${ids.length} ${ids.length === 1 ? "batter" : "batters"}. Recorded at-bats keep their original slot numbers.`
            : before > 0 && (await isTracked(supabase, gameId))
            ? `${added} late ${added === 1 ? "batter" : "batters"} added at the end of the order.`
            : `Lineup saved — ${ids.length} batters.`,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Copies a lineup from a source game the coach explicitly chose.
 *
 * Replaces copy_previous_lineup(), which inferred the source as the "most
 * recent earlier game" and tie-broke on game id. Because ids are random UUIDs,
 * four games played on one day resolved arbitrarily: copying into game 3 could
 * pull from game 4. No ordering rule is trusted here — the source is an
 * argument.
 *
 * This is a SNAPSHOT. Rows are read from the source and inserted as new rows
 * against the destination; no reference to the source is kept, so later edits
 * to either lineup leave the other untouched. The source game is only ever
 * read.
 *
 * Plate appearances are never copied. A lineup is who is due to bat; QAB
 * history belongs to the game it was recorded in.
 */
export async function copyLineupFrom(gameId, sourceGameId, { replace = false } = {}) {
  try {
    await guard();
    const supabase = createClient();

    if (!gameId) return { ok: false, error: "Missing game reference." };
    if (!sourceGameId) return { ok: false, error: "Choose a game to copy from." };
    if (gameId === sourceGameId) {
      return { ok: false, error: "That's the same game. Choose a different one to copy from." };
    }

    const scope = await gameScope(supabase, gameId);
    const source = await gameScope(supabase, sourceGameId);

    // Scoping is checked here as well as by RLS: a copy crossing seasons would
    // otherwise write rows whose season_id disagreed with the destination.
    if (source.season_id !== scope.season_id) {
      return { ok: false, error: "That game belongs to a different season." };
    }

    // A game that is already being tracked keeps its batting order. The database
    // refuses too; saying so first gives a clearer message than a rejected write.
    if (await isTracked(supabase, gameId)) {
      return {
        ok: false,
        error:
          "This game is already being tracked, so its batting order can't be replaced. Copying is only available before the first at-bat.",
      };
    }

    const { data: existing, error: exErr } = await supabase
      .from("game_lineup_slots")
      .select("id")
      .eq("game_id", gameId);
    if (exErr) return { ok: false, error: friendly(exErr) };

    // The destination already has an order. Replacing it is destructive, so it
    // needs a deliberate second action rather than happening on first tap.
    if ((existing ?? []).length > 0 && !replace) {
      return {
        ok: false,
        needsConfirm: true,
        existing: existing.length,
        error: `This game already has a lineup of ${existing.length} batters.`,
      };
    }

    const { data: sourceSlots, error: srcErr } = await supabase
      .from("game_lineup_slots")
      .select("player_id, batting_order, player:players ( id, archived_at )")
      .eq("game_id", sourceGameId)
      .order("batting_order");
    if (srcErr) return { ok: false, error: friendly(srcErr) };

    // Archived players are skipped, which can leave a gap in the copied
    // numbering. Renumbering from position keeps the order contiguous, which
    // is what every downstream QAB reader expects.
    const usable = (sourceSlots ?? []).filter((s2) => !s2.player?.archived_at);

    if (usable.length === 0) {
      return { ok: false, error: "That game's lineup has no active players to copy." };
    }

    // Atomic: if this fails the destination keeps the lineup it had.
    const { error: rpcErr } = await supabase.rpc("replace_game_lineup", {
      p_game_id: gameId,
      p_player_ids: usable.map((s2) => s2.player_id),
    });
    if (rpcErr) return { ok: false, error: friendly(rpcErr) };

    const { data: finalSlots } = await supabase
      .from("game_lineup_slots")
      .select("player_id, batting_order, player:players ( id, full_name )")
      .eq("game_id", gameId)
      .order("batting_order");

    // Jersey and participation come from THIS tournament's participants — a
    // pickup who wore #23 at the source event does not carry it forward.
    const { data: participants } = await supabase
      .from("tournament_participants")
      .select("player_id, jersey_number, participation")
      .eq("tournament_id", scope.tournament_id);

    const meta = new Map((participants ?? []).map((pt) => [pt.player_id, pt]));

    const order = (finalSlots ?? []).map((s2) => ({
      player_id: s2.player_id,
      full_name: s2.player?.full_name ?? "Unknown player",
      jersey_number: meta.get(s2.player_id)?.jersey_number ?? null,
      participation: meta.get(s2.player_id)?.participation ?? null,
      batting_order: s2.batting_order,
    }));

    revalidatePath("/tournaments");
    const skipped = (sourceSlots ?? []).length - usable.length;
    return {
      ok: true,
      copied: usable.length,
      order,
      notice:
        `Copied ${usable.length} batters.` +
        (skipped > 0 ? ` ${skipped} archived ${skipped === 1 ? "player was" : "players were"} skipped.` : "") +
        " Make any changes, then save.",
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Previews an earlier game's batting order as an UNSAVED draft (Release 2).
 *
 * Writes nothing. The coach sees the order on the lineup screen marked "Not
 * saved yet" and saves it with the ordinary Save, which is the only write.
 * Players who cannot be used in this game (archived, inactive, or not on this
 * season's roster or this tournament's roster) are left out and counted, so a
 * draft that Save would refuse is never offered.
 *
 * Refused for a game that already has a saved order or recorded at-bats: the
 * suggestion exists only for an empty destination, and an existing lineup is
 * never replaced from here.
 */
export async function previewLineupFrom(gameId, sourceGameId) {
  try {
    await guard();
    const supabase = createClient();

    if (!gameId || !sourceGameId) return { ok: false, error: "Choose a game to copy from." };
    if (gameId === sourceGameId) return { ok: false, error: "Choose a different game." };

    const scope = await gameScope(supabase, gameId);
    const source = await gameScope(supabase, sourceGameId);
    if (source.season_id !== scope.season_id) {
      return { ok: false, error: "That game belongs to a different season." };
    }
    if (await isTracked(supabase, gameId)) {
      return { ok: false, error: "This game is already being tracked, so its batting order can't be changed here." };
    }
    if ((await currentCount(supabase, gameId)) > 0) {
      return { ok: false, error: "This game already has a saved lineup." };
    }

    const { data: sourceSlots, error: srcErr } = await supabase
      .from("game_lineup_slots")
      .select("player_id, batting_order, player:players ( id, full_name, archived_at )")
      .eq("game_id", sourceGameId)
      .order("batting_order");
    if (srcErr) return { ok: false, error: friendly(srcErr) };

    const eligible = await eligiblePlayerIds(supabase, scope);
    const usable = (sourceSlots ?? []).filter((s2) => !s2.player?.archived_at && eligible.has(s2.player_id));
    if (usable.length === 0) {
      return { ok: false, error: "That game's lineup has no players available for this game." };
    }

    const { data: participants } = await supabase
      .from("tournament_participants")
      .select("player_id, jersey_number, participation")
      .eq("tournament_id", scope.tournament_id);
    const meta = new Map((participants ?? []).map((pt) => [pt.player_id, pt]));

    const order = usable.map((s2, i) => ({
      player_id: s2.player_id,
      full_name: s2.player?.full_name ?? "Unknown player",
      jersey_number: meta.get(s2.player_id)?.jersey_number ?? null,
      participation: meta.get(s2.player_id)?.participation ?? null,
      batting_order: i + 1,
    }));
    const skipped = (sourceSlots ?? []).length - usable.length;
    return { ok: true, order, skipped };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Substitutes a different player into an existing batting slot, mid-game.
 *
 * The only write is game_lineup_slots.player_id for that one slot. Plate
 * appearances are never touched: each PA stores its own player_id, and
 * enforce_pa_attribution() re-copies batting_order from OLD on every UPDATE,
 * so history cannot be reattributed by changing a lineup. The starter keeps
 * every at-bat they recorded; the substitute is credited from their first.
 *
 * Distinct from saveLineup, which replaces the whole order and is the pre-game
 * tool. A substitution is a single, surgical change made while the game is
 * running, and keeping them separate means an in-game action can never
 * renumber the slots a plate appearance was recorded against.
 */
export async function substitutePlayer(gameId, battingOrder, newPlayerId) {
  try {
    await guard();
    const supabase = createClient();

    if (!gameId) return { ok: false, error: "Missing game reference." };
    if (!newPlayerId) return { ok: false, error: "Choose the player coming in." };

    const slotNumber = Number(battingOrder);
    if (!Number.isInteger(slotNumber) || slotNumber < 1) {
      return { ok: false, error: "That batting position isn't valid." };
    }

    const scope = await gameScope(supabase, gameId);

    /* Same eligibility set as lineup setup, so a substitution can never be
       narrower than the order it is changing — a tournament pickup stays
       valid, and so does an active roster player who was not listed for this
       tournament. A player from another organization is not in the set. */
    const eligible = await eligiblePlayerIds(supabase, scope);
    if (!eligible.has(newPlayerId)) {
      return {
        ok: false,
        error: "That player isn't on this team's roster or tournament roster.",
      };
    }

    const { data: slot, error: slotErr } = await supabase
      .from("game_lineup_slots")
      .select("id, player_id")
      .eq("game_id", gameId)
      .eq("batting_order", slotNumber)
      .maybeSingle();

    if (slotErr) return { ok: false, error: friendly(slotErr) };
    if (!slot) return { ok: false, error: "That batting position isn't in this lineup." };

    if (slot.player_id === newPlayerId) {
      return { ok: false, error: "That player is already batting in this position." };
    }

    // UNIQUE (game_id, player_id) would reject this anyway; saying so plainly
    // is more use to a coach mid-game than a constraint error.
    const { data: clash } = await supabase
      .from("game_lineup_slots")
      .select("batting_order")
      .eq("game_id", gameId)
      .eq("player_id", newPlayerId)
      .maybeSingle();

    if (clash) {
      return {
        ok: false,
        error: `That player is already batting in position ${clash.batting_order}.`,
      };
    }

    // By position, not by row id, and the row count is checked: a lineup that
    // was replaced between the read above and this write must not report a
    // substitution that changed nothing.
    const { data: changed, error: updErr } = await supabase
      .from("game_lineup_slots")
      .update({ player_id: newPlayerId })
      .eq("game_id", gameId)
      .eq("batting_order", slotNumber)
      .select("id");

    if (updErr) return { ok: false, error: friendly(updErr) };
    if (!changed || changed.length !== 1) {
      return { ok: false, error: "That batting position changed while you were substituting. Reload and try again." };
    }

    revalidatePath("/tournaments");
    revalidatePath("/performance");
    return { ok: true, battingOrder: slotNumber, notice: "Substitution recorded." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
