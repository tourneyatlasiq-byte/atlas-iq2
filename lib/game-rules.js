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

export const GAME_TYPES = ["Pool", "Bracket", "Championship", "Friendly", "Scrimmage"];

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
