/**
 * The calendar date the person is looking at (2026-11).
 *
 * Tournament dates are plain YYYY-MM-DD strings with no time zone. "Today" for
 * them means the date on the coach's own device, not UTC: after about 7pm
 * Eastern, UTC is already tomorrow, which made a tournament ending today
 * disappear from "Next up" and a same-day event read as tomorrow.
 *
 * This is for deciding what to SHOW (which tournament is next, which tab opens).
 * It is never used for stored timestamps, game dates, the future-score rule or
 * anything a plate appearance records. Those keep their own rules.
 */

/** The device's calendar date as YYYY-MM-DD. Call only where the device's clock is wanted (a browser). */
export function localDateIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * The UTC date as YYYY-MM-DD. The server renders with this because it cannot
 * know the visitor's time zone; the browser replaces it with localDateIso()
 * as soon as it mounts, so the first paint matches the server's HTML.
 */
export function utcDateIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

const toUtcDay = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole calendar days from a to b (b minus a). Both are YYYY-MM-DD; time zones and daylight saving cannot shift it. */
export function daysBetween(a, b) {
  return Math.round((toUtcDay(b) - toUtcDay(a)) / 86400000);
}

/** "Thursday, November 19" for a YYYY-MM-DD date, read at noon so it never slides a day. */
export function longDayLabel(iso) {
  return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
