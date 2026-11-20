import { isWaitlisted } from "./tournament-status";
import { daysBetween } from "./local-date";

/**
 * The tournament a screen features as "the trip": Home's Next up card, the
 * Tournaments Next tournament view and the Locations & Resources block.
 * One rule, so they can never disagree (2026-11).
 *
 * Eligible: Committed, not Waitlisted (no confirmed place yet), not finished.
 * Declined and Considering are never featured. A tournament is finished once
 * its last day (end date, or the start date for a one day event) is before
 * today.
 *
 * Order: a tournament that is in progress today comes first. Otherwise the
 * soonest start. Ties (two events the same day, or two in progress) resolve
 * by earlier start, earlier end, then name, then id, so the pick is the same
 * on every screen and every load.
 *
 * `today` is a YYYY-MM-DD string passed in: the device's date in the browser
 * (localDateIso) or the UTC date for the first server render. This function
 * never reads a clock.
 */
export function isFeaturable(t) {
  if (!t || t.decision !== "Committed") return false;
  if (isWaitlisted(t.paid_status)) return false;
  const start = t.start_date ? String(t.start_date).slice(0, 10) : null;
  if (!start) return false;
  return true;
}

const lastDay = (t) => {
  const start = String(t.start_date).slice(0, 10);
  const end = t.end_date ? String(t.end_date).slice(0, 10) : null;
  return end && end > start ? end : start;
};

export function featuredTournament(tournaments, today) {
  const start = (t) => String(t.start_date).slice(0, 10);
  const live = (tournaments ?? [])
    .filter(isFeaturable)
    .filter((t) => lastDay(t) >= today);
  if (!live.length) return null;

  const inProgress = (t) => start(t) <= today;
  const cmp = (a, b) =>
    Number(inProgress(b)) - Number(inProgress(a)) ||
    start(a).localeCompare(start(b)) ||
    lastDay(a).localeCompare(lastDay(b)) ||
    String(a.name ?? "").localeCompare(String(b.name ?? "")) ||
    String(a.id ?? "").localeCompare(String(b.id ?? ""));

  const t = [...live].sort(cmp)[0];
  const daysAway = Math.max(0, daysBetween(today, start(t)));
  const totalDays = daysBetween(start(t), lastDay(t)) + 1;
  const dayNumber = inProgress(t) ? daysBetween(start(t), today) + 1 : 0;

  let state = "upcoming";
  if (inProgress(t)) state = dayNumber === 1 ? "today" : "in_progress";

  return { tournament: t, daysAway, state, dayNumber, totalDays };
}

/** The words for it: "Today", "In progress, day 2 of 3", "Tomorrow", "in 5 days". */
export function featuredLabel(f) {
  if (!f) return "";
  if (f.state === "today") return "Today";
  if (f.state === "in_progress") return `In progress, day ${f.dayNumber} of ${f.totalDays}`;
  return f.daysAway === 1 ? "Tomorrow" : `in ${f.daysAway} days`;
}
