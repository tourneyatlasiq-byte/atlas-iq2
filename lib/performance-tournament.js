/**
 * Which tournament Performance shows (2026-11).
 *
 * Coaches enter QABs live, later that night, or days after a weekend, so the
 * page must never let an upcoming tournament with no games hide one that still
 * has games waiting for QABs. Pure functions: no database, no dates from the
 * clock (callers pass `today` as YYYY-MM-DD) — which is what makes every rule
 * here directly testable.
 *
 * Default priority, when the URL does not name a tournament:
 *   1. a tournament happening now — today within its start..end dates, inclusive
 *   2. the most recent past tournament with games still needing QABs
 *   3. the next upcoming tournament that has games
 *   4. the next upcoming tournament
 *   5. the most recent tournament
 */

const endOf = (t) => t.end_date ?? t.start_date ?? null;

/** Today falls anywhere in the tournament's dates, inclusive (Fri–Sun stays "now" on Sat and Sun). */
export function isHappeningNow(t, today) {
  if (!t?.start_date) return false;
  return t.start_date <= today && today <= endOf(t);
}

export function isPast(t, today) {
  const end = endOf(t);
  return Boolean(end) && end < today;
}

export function isUpcoming(t, today) {
  return Boolean(t?.start_date) && t.start_date > today;
}

/** "now" | "past" | "upcoming" | "undated" — drives the header's eyebrow. */
export function tournamentTiming(t, today) {
  if (isHappeningNow(t, today)) return "now";
  if (isPast(t, today)) return "past";
  if (isUpcoming(t, today)) return "upcoming";
  return "undated";
}

/**
 * stats: Map(tournamentId -> { games, needQab }) where needQab counts games not
 * yet marked complete (no lineup, not started, or in progress).
 */
export function pickDefaultTournament(tournaments, stats, today) {
  const list = (tournaments ?? []).filter(Boolean);
  if (list.length === 0) return null;
  const s = (t) => stats?.get(t.id) ?? { games: 0, needQab: 0 };
  const byStart = (a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999");
  const byRecent = (a, b) => (endOf(b) ?? "").localeCompare(endOf(a) ?? "");

  const now = list.filter((t) => isHappeningNow(t, today)).sort(byStart);
  if (now.length) return now[0];

  const pastNeeding = list.filter((t) => isPast(t, today) && s(t).needQab > 0).sort(byRecent);
  if (pastNeeding.length) return pastNeeding[0];

  const upcoming = list.filter((t) => isUpcoming(t, today)).sort(byStart);
  const upcomingWithGames = upcoming.filter((t) => s(t).games > 0);
  if (upcomingWithGames.length) return upcomingWithGames[0];
  if (upcoming.length) return upcoming[0];

  const past = list.filter((t) => isPast(t, today)).sort(byRecent);
  if (past.length) return past[0];
  return list[list.length - 1];
}

/** Compact status for the selector: "No games yet" | "7 games need QABs" | "QABs complete". */
export function tournamentQabStatus(stat) {
  const games = stat?.games ?? 0;
  const need = stat?.needQab ?? 0;
  if (games === 0) return "No games yet";
  if (need > 0) return need === 1 ? "1 game needs QABs" : `${need} games need QABs`;
  return "QABs complete";
}

export function tournamentOptionLabel(t, stat) {
  return `${t.name} · ${tournamentQabStatus(stat)}`;
}
