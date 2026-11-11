/**
 * Game rules and vocabulary.
 *
 * Pure — no server imports, no "use server" — so both server actions and client
 * components can use it.
 *
 * This exists because a "use server" file may only export async functions.
 * GAME_TYPES previously lived in lib/actions/games.js, which made the whole
 * module invalid and broke every game write.
 */

// Display order (2026-11): event play first, informal play last. Must match the
// games_game_type_check constraint (migration games_04). Every type counts the
// same toward W-L-T and QAB statistics; the type is a label only.
export const GAME_TYPES = ["Pool", "Bracket", "Championship", "Showcase", "Friendly", "Scrimmage"];

/** A game dated after today has not been played, so it can carry no outcome. */
export function isFutureGame(gameDate, today = new Date()) {
  if (!gameDate) return false;
  return gameDate > today.toISOString().slice(0, 10);
}

/**
 * Win/loss/tie from a score.
 *
 * Mirrors enforce_game_result_timing() in the database, which is authoritative
 * and overwrites `result` on every write. Used here only to preview what will
 * be stored — never to decide it.
 */
export function deriveResult(runsFor, runsAgainst) {
  if (runsFor == null || runsAgainst == null) return null;
  if (runsFor > runsAgainst) return "W";
  if (runsFor < runsAgainst) return "L";
  return "T";
}

/** Record from a set of games. Only played games with a result count. */
export function recordFrom(games, today = new Date()) {
  const played = (games ?? []).filter(
    (g) => g.result && g.game_date && !isFutureGame(g.game_date, today)
  );
  return {
    w: played.filter((g) => g.result === "W").length,
    l: played.filter((g) => g.result === "L").length,
    t: played.filter((g) => g.result === "T").length,
    played: played.length,
  };
}

/* ---------- Final score at the end of QAB tracking (2026-11) ----------
   QAB completion and the final score are separate facts on the game row
   (qab_completed_at vs runs_for / runs_against / result). Finishing tracking
   never requires a score; these rules only describe what the coach typed and
   whether a completed game is still waiting for its score. */

/**
 * The state of the two score fields as typed.
 *   blank    — both empty: finishing will save no score
 *   partial  — exactly one entered: not a score (the database agrees)
 *   invalid  — both entered but not whole numbers of runs, 0 or more
 *   complete — both valid; runsFor / runsAgainst are numbers
 */
export function scoreEntry(ourRaw, oppRaw) {
  const given = (v) => v !== "" && v != null && String(v).trim() !== "";
  const us = given(ourRaw), them = given(oppRaw);
  if (!us && !them) return { state: "blank" };
  if (us !== them) return { state: "partial" };
  const runsFor = Number(ourRaw);
  const runsAgainst = Number(oppRaw);
  const ok = (n) => Number.isInteger(n) && n >= 0;
  if (!ok(runsFor) || !ok(runsAgainst)) return { state: "invalid" };
  return { state: "complete", runsFor, runsAgainst };
}

const RESULT_WORD = { W: "Win", L: "Loss", T: "Tie" };

/** "7–3 · Win". Null when there is no score to show. */
export function formatFinalScore(runsFor, runsAgainst, result) {
  if (runsFor == null || runsAgainst == null) return null;
  const r = result ?? deriveResult(runsFor, runsAgainst);
  return `${runsFor}–${runsAgainst}${r ? ` · ${RESULT_WORD[r]}` : ""}`;
}

/**
 * Whether a tracked game is still waiting for its final score: QAB tracking is
 * complete, the game is not dated in the future, and it has neither a score
 * nor a result. A result recorded without a score (the game form's "Result
 * without a score") counts as an outcome the coach chose to record, so it is
 * not chased.
 */
export function needsFinalScore(game, today = new Date()) {
  if (!game?.completed) return false;
  if (isFutureGame(game.gameDate, today)) return false;
  return game.runsFor == null && game.runsAgainst == null && !game.result;
}
