/**
 * One way to show a tournament's dates (2026-11).
 *
 * Tournaments are one day, a weekend, midweek, or a full week, and the same
 * range used to be formatted four different ways. Dates are plain
 * YYYY-MM-DD strings (no time zone), read at noon so a date never slides a day.
 *
 *   one day              Nov 7
 *   same month           Nov 7 to 9      (a full week: Jul 6 to 12)
 *   across months        Nov 29 to Dec 2
 *   across a new year    Dec 29, 2026 to Jan 4, 2027   (year shown only here)
 *   end before start     Nov 7           (bad data shows the start, never a backwards range)
 *   no start             "Date not set"  (or opts.empty)
 */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const at = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00`);
const DAY_MS = 86400000;

// The end date that counts: missing, equal or before the start means one day.
function endOf(a, b) {
  return b && String(b).slice(0, 10) > String(a).slice(0, 10) ? b : null;
}

/**
 * The one rule for a tournament's dates: an end date, when given, cannot be
 * before the start date. Returns a message a coach can act on, or null when the
 * dates are fine. Used by the form and by the server actions, so the two
 * cannot disagree. Equal dates are valid (a one-day event); an empty end date
 * is valid (one day).
 */
export const DATE_RANGE_MESSAGE =
  "The end date can't be before the start date. Change the end date, or leave it empty for a one-day tournament.";
export function dateRangeError(start, end) {
  const s = String(start ?? "").slice(0, 10);
  const e = String(end ?? "").slice(0, 10);
  if (!s || !e) return null;
  return e < s ? DATE_RANGE_MESSAGE : null;
}

export function fmtDateRange(a, b, opts = {}) {
  if (!a) return opts.empty ?? "Date not set";
  const e = endOf(a, b);
  const x = at(a);
  const md = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;
  if (!e) return md(x);
  const y = at(e);
  if (x.getFullYear() !== y.getFullYear()) return `${md(x)}, ${x.getFullYear()} to ${md(y)}, ${y.getFullYear()}`;
  return x.getMonth() === y.getMonth() ? `${md(x)} to ${y.getDate()}` : `${md(x)} to ${md(y)}`;
}

/** Whole days the tournament covers, counting both ends (Jul 6 to 12 is 7). One day is 1. */
export function daySpan(a, b) {
  if (!a) return 0;
  const e = endOf(a, b);
  return e ? Math.round((at(e) - at(a)) / DAY_MS) + 1 : 1;
}

/** "Sat" for one day, "Fri to Sun" for a weekend, "Mon to Sun · 7 days" once it runs four days or more. */
export function fmtDayRange(a, b) {
  if (!a) return "";
  const e = endOf(a, b);
  const s = DOW[at(a).getDay()];
  if (!e) return s;
  const n = daySpan(a, b);
  return `${s} to ${DOW[at(e).getDay()]}${n >= 4 ? ` · ${n} days` : ""}`;
}
