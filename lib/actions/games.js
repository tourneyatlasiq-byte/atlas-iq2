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

/**
 * Finishing QAB tracking.
 *
 * Completion is a deliberate coach decision and is never inferred — not from
 * plate appearance count, lineup rotation, batting-order wraparound, score or
 * elapsed time. Softball has no predetermined number of plate appearances, and
 * pool games end on time limits.
 *
 * This is also distinct from the tracker's "All saved" indicator. That reports
 * whether the offline queue is empty, which is equally true after one at-bat
 * and after the last. Saving and finishing are different facts.
 *
 * Deliberately not queueable offline: the caller flushes first and only calls
 * this once nothing is pending, so the totals a coach confirms are the totals
 * that were stored.
 */
export async function finishGameTracking(gameId, score = null) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    if (!gameId) return { ok: false, error: "Missing game reference." };

    /**
     * Finishing tracking and recording a score are two different facts, and
     * they are written in two separate statements on purpose.
     *
     * enforce_game_result_timing() refuses a score on a game dated in the
     * future. Sending completion and score in ONE update meant that refusal
     * rejected the whole row: the coach pressed Finish tracking on a game
     * scheduled for a later date, the score was illegal, and
     * qab_completed_at was never written either — so nothing finished. That
     * rule is right and stays; the coupling was the defect.
     *
     * Completion is written first and is never blocked by the score rule.
     * A score that cannot legally be stored yet is reported back as a note,
     * not as a failure to finish.
     */
    const { data: done, error: doneErr } = await supabase
      .from("games")
      .update({
        qab_completed_at: new Date().toISOString(),
        qab_completed_by: ctx.profile.id,
      })
      .eq("id", gameId)
      .select("id, qab_completed_at, game_date");

    if (doneErr) return { ok: false, error: friendly(doneErr) };
    if (!done || done.length === 0) return { ok: false, error: "That game could not be found." };

    const completedAt = done[0].qab_completed_at;
    let scoreNote = null;
    let saved = { runs_for: null, runs_against: null, result: null };

    const given = (v) => v !== "" && v != null;
    const wantsScore = score && (given(score.runsFor) || given(score.runsAgainst));

    if (wantsScore) {
      if (given(score.runsFor) !== given(score.runsAgainst)) {
        scoreNote = "Tracking finished. Enter both scores or neither — no score was saved.";
      } else {
        const f = Number(score.runsFor);
        const a = Number(score.runsAgainst);

        if (!Number.isInteger(f) || !Number.isInteger(a) || f < 0 || a < 0) {
          scoreNote = "Tracking finished. Scores must be whole numbers of runs — no score was saved.";
        } else {
          // result is deliberately NOT set here. The database derives W/L/T
          // from the two figures, so writing it would duplicate that rule.
          const { data: scored, error: scoreErr } = await supabase
            .from("games")
            .update({ runs_for: f, runs_against: a })
            .eq("id", gameId)
            .select("id, runs_for, runs_against, result");

          if (scoreErr) {
            // Tracking is already finished; only the score was refused.
            scoreNote = `Tracking finished, but the score wasn't saved: ${friendly(scoreErr)}`;
          } else if (scored && scored.length > 0) {
            saved = scored[0];
          }
        }
      }
    }

    revalidatePath("/performance");
    revalidatePath("/tournaments");

    return {
      ok: true,
      completedAt,
      runsFor: saved.runs_for,
      runsAgainst: saved.runs_against,
      result: saved.result,
      scoreNote,
      notice:
        scoreNote ??
        (saved.result
          ? `QAB tracking complete — recorded as a ${
              saved.result === "W" ? "win" : saved.result === "L" ? "loss" : "tie"
            }.`
          : "QAB tracking complete."),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Reopening a completed game.
 *
 * Correcting what was recorded and deciding the game is not over are different
 * acts. Corrections stay available on a completed game; recording a NEW plate
 * appearance requires this first, and the database enforces that in
 * enforce_pa_integrity() rather than relying on the interface.
 *
 * Last-write-wins by design: no finish/resume history is kept.
 */
export async function resumeGameTracking(gameId) {
  try {
    await guard();
    const supabase = createClient();

    if (!gameId) return { ok: false, error: "Missing game reference." };

    const { data, error } = await supabase
      .from("games")
      .update({ qab_completed_at: null, qab_completed_by: null })
      .eq("id", gameId)
      .select("id");

    if (error) return { ok: false, error: friendly(error) };
    if (!data || data.length === 0) return { ok: false, error: "That game could not be found." };

    revalidatePath("/performance");
    revalidatePath("/tournaments");
    return { ok: true, notice: "Tracking reopened." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
