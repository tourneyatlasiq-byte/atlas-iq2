/**
 * Game-flow rules (Release 2, 2026-11): which game Home opens, what is offered
 * after a game is finished, and when the previous lineup is suggested.
 *
 * Pure: no React, no database and no clock. `today` is a YYYY-MM-DD string
 * the caller supplies (the device date in the browser), so every screen agrees.
 *
 * Nothing here navigates or writes. These functions only pick; the screens
 * decide what the coach sees, and every write stays an explicit tap.
 *
 * A game is "finished" ONLY when QAB tracking was explicitly completed. A
 * score (result) can be entered from Performance at any time and does not mean
 * the coach is done tracking at-bats, so it never ends a game here.
 * A game is "started" once it has a recorded at-bat.
 */

const when = (g) => `${g.game_date ?? ""}|${g.start_time ?? "99:99"}|${g.id ?? ""}`;
const isFinished = (g) => !!g.qabCompleted;
const isStarted = (g) => (g.plateAppearances ?? 0) > 0;
const sortAsc = (games) => [...(games ?? [])].sort((a, b) => when(a).localeCompare(when(b)));

/** The one button for a game, or null when it is finished (results stay). */
export function gameStep(game) {
  if (!game || isFinished(game)) return null;
  if (isStarted(game)) return { label: "Continue tracking", route: "track" };
  if ((game.batters ?? 0) > 0) return { label: "Start tracking", route: "track" };
  return { label: "Set lineup", route: "lineup" };
}

/**
 * Today's relevant game: a game already being tracked first, otherwise the
 * earliest unfinished game dated today. Games without a time follow timed ones.
 */
export function todaysGame(games, today) {
  const open = sortAsc(games).filter((g) => g.game_date === today && !isFinished(g));
  return open.find(isStarted) ?? open[0] ?? null;
}

/** Earlier games that were started and never finished, newest first. Secondary. */
export function olderUnfinished(games, today) {
  return sortAsc(games)
    .filter((g) => g.game_date && g.game_date < today && isStarted(g) && !isFinished(g))
    .reverse();
}

/**
 * The game to offer after `currentId` is finished: the next unfinished game
 * that follows it in the schedule and is dated today or later.
 */
export function nextGameAfter(games, currentId, today) {
  const ordered = sortAsc(games);
  const i = ordered.findIndex((g) => g.id === currentId);
  if (i < 0) return null;
  return ordered.slice(i + 1).find((g) => g.game_date && g.game_date >= today && !isFinished(g)) ?? null;
}

function fmtTime(t) {
  const [h, m] = String(t).split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** 1-based position of a game in its tournament's schedule, or null. */
export function gameNumber(games, id) {
  const i = sortAsc(games).findIndex((g) => g.id === id);
  return i < 0 ? null : i + 1;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const noon = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`);

/**
 * "Game 2, 11:00 AM" for a game today. A game on another day says when:
 * "Game 3, Tomorrow, 9:00 AM" or "Game 4, Sun Nov 22, 1:05 PM". `today` is the
 * device date; without it the compact same-day label is used.
 */
export function nextGameLabel(game, number, today) {
  let when_ = null;
  if (today && game.game_date && String(game.game_date).slice(0, 10) !== today) {
    const d = noon(game.game_date);
    const days = Math.round((d - noon(today)) / 86400000);
    when_ = days === 1 ? "Tomorrow" : `${DOW[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  return [`Game ${number}`, when_, game.start_time ? fmtTime(game.start_time) : null].filter(Boolean).join(", ");
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Hawks, Nov 20 (9 batters)". */
export function lineupSuggestionLabel(source) {
  const d = source.game_date ? String(source.game_date).split("-") : null;
  const date = d ? `${MON[Number(d[1]) - 1]} ${Number(d[2])}` : null;
  const n = source.batters ?? 0;
  const who = source.opponent_name || "Earlier game";
  return `${who}${date ? `, ${date}` : ""} (${n} ${n === 1 ? "batter" : "batters"})`;
}

/**
 * The earlier game whose order may be offered as an unsaved draft. Only for a
 * destination with no saved lineup, no at-bats and no draft, never in recovery
 * mode, never for a read-only role and never once "Not now" was tapped.
 */
export function lineupSuggestion({ destination, sources, canWrite, hasDraft, dismissed, recovery }) {
  if (!canWrite || hasDraft || dismissed || recovery) return null;
  if (!destination || (destination.batters ?? 0) > 0 || (destination.plateAppearances ?? 0) > 0) return null;
  const key = (g) => `${g.game_date ?? ""}|${g.start_time ?? ""}`;
  const dest = destination.start_time ? key(destination) : `${destination.game_date ?? ""}|`;
  const earlier = (sources ?? [])
    .filter((s) => (s.batters ?? 0) > 0 && s.id !== destination.id)
    .filter((s) => (destination.start_time ? key(s) : `${s.game_date ?? ""}|`) < dest);
  if (!earlier.length) return null;
  return [...earlier].sort((a, b) => key(b).localeCompare(key(a)) || String(a.id).localeCompare(String(b.id)))[0];
}

/**
 * Where a game step goes. `from` tells the destination where the coach came
 * from, so its back link returns there instead of to the lineup. `extra` may
 * carry `scope` (a tournament id) and `player` (a player id) for the origins
 * that need them; they are dropped when there is no `from`.
 */
const EXTRA_KEYS = ["player", "scope"];
export function gameHref(tournamentId, gameId, route, from = null, extra = {}) {
  const base = `/tournaments/${tournamentId}/games/${gameId}/${route}`;
  if (!from) return base;
  const q = [`from=${encodeURIComponent(from)}`];
  for (const k of EXTRA_KEYS) {
    const v = extra?.[k];
    if (typeof v === "string" && v) q.push(`${k}=${encodeURIComponent(v)}`);
  }
  return `${base}?${q.join("&")}`;
}

/**
 * The pages a `from` value may name (TRK-002, Release 3). The address is built
 * here from fixed paths and ids checked as ids, never taken from the request,
 * so nothing arbitrary can be followed. A name that cannot be resolved (a
 * missing or malformed id) returns null and the page keeps its fixed link.
 *
 *   home          Home (its scroll restore is separate and unchanged)
 *   tournament    that tournament's drawer on Tournaments
 *   performance   Performance, with the tournament selection kept
 *   player-report that player's report, with Season or Tournament scope kept
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const validId = (v) => (typeof v === "string" && ID.test(v) ? v : null);
const BACK_NAMES = {
  home: () => ({ href: "/dashboard", label: "Home" }),
  tournament: ({ tournamentId }) => {
    const id = validId(tournamentId);
    return id ? { href: `/tournaments?open=${id}`, label: "Tournament" } : null;
  },
  performance: ({ scope }) => {
    const id = validId(scope);
    return { href: id ? `/performance?tournament=${id}` : "/performance", label: "Performance" };
  },
  "player-report": ({ player, scope }) => {
    const p = validId(player);
    if (!p) return null;
    const s = validId(scope);
    return { href: `/reports/qab-player?player=${p}${s ? `&scope=tournament&tournament=${s}` : ""}`, label: "Player report" };
  },
};
export const BACK_TARGETS = BACK_NAMES;
export function backTarget(from, ctx = {}) {
  if (typeof from !== "string" || !Object.prototype.hasOwnProperty.call(BACK_NAMES, from)) return null;
  return BACK_NAMES[from](ctx ?? {});
}
