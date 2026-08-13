import { createClient } from "../supabase/server";
import { tallyPlateAppearances } from "../qab-rules";

/**
 * Plate appearance reads.
 *
 * One data model for both QAB entry paths. The live phone tracker and the
 * retrospective desktop grid read the same rows through the same functions —
 * there is no "live" table and no "retrospective" table, and no aggregate
 * counter anywhere. PA, QAB and QAB% are always derived from the rows.
 *
 * Voided rows are returned rather than filtered out. A tracker needs to show
 * what was undone so a mis-tap is visible, and a retrospective grid needs to
 * distinguish "not entered" from "entered then removed". Every consumer that
 * counts must use the qab-rules helpers, which exclude voided rows, matching
 * `where voided_at is null` in the qab_* views.
 */

const PA_COLUMNS =
  "id, game_id, player_id, pa_number, inning, qab_reasons, is_qab, notes, " +
  "recorded_by, created_at, updated_at, voided_at, voided_by";

/**
 * Every plate appearance for a game, voided included.
 *
 * Ordered by player then plate appearance so a desktop grid can group by
 * batter without a second pass, and the phone tracker can find a batter's most
 * recent entry cheaply.
 */
export async function listGamePlateAppearances(gameId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("plate_appearances")
    .select(PA_COLUMNS)
    .eq("game_id", gameId)
    .order("player_id")
    .order("pa_number");

  if (error) throw new Error(`Could not load plate appearances: ${error.message}`);
  return data ?? [];
}

/** Live rows only, keyed by player, for callers that just want the counts. */
export function groupByPlayer(rows) {
  const byPlayer = new Map();
  for (const r of rows ?? []) {
    byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  }
  return byPlayer;
}

/**
 * PA / QAB / QAB% per player for one game, plus a game total.
 *
 * The maths lives in qab-rules and is not reimplemented here — a plate
 * appearance with five reasons is one quality at bat, an explicit non-QAB
 * counts in the denominator, and voided rows count in neither.
 */
export function summarizeGame(rows) {
  const byPlayer = groupByPlayer(rows);
  const perPlayer = new Map();
  for (const [playerId, records] of byPlayer) {
    perPlayer.set(playerId, tallyPlateAppearances(records));
  }
  return { perPlayer, total: tallyPlateAppearances(rows) };
}

/**
 * The next plate appearance number for a batter in a game.
 *
 * Per player, per game: a batter's first time up is 1. Derived from live rows
 * only, so voiding the most recent entry frees its number for reuse — which is
 * exactly what undo-then-re-record should do. Voiding a middle entry leaves a
 * gap, and that is correct: the later plate appearances genuinely happened and
 * must not be renumbered underneath a coach who is looking at them.
 *
 * Callers may compute this client-side while offline. The unique index
 * `plate_appearances_natural_key` is the real guard.
 */
export function nextPaNumber(rows, playerId) {
  const live = (rows ?? []).filter((r) => r.player_id === playerId && !r.voided_at);
  return live.reduce((max, r) => Math.max(max, r.pa_number ?? 0), 0) + 1;
}

/** One plate appearance by id, for a correction screen that deep-links. */
export async function getPlateAppearance(id) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("plate_appearances")
    .select(PA_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load that plate appearance: ${error.message}`);
  return data ?? null;
}
