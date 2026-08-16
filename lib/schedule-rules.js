/**
 * Pure Tournament Schedule rules.
 *
 * Server-free by design (no next/headers, no Supabase client), so the query
 * layer and the report document read one implementation and the rules can be
 * tested without a browser or a database.
 */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/**
 * Plain YYYY-MM-DD parsed as a LOCAL date.
 *
 * new Date("2026-08-05") is parsed as UTC and renders as Aug 4 in any western
 * timezone — a schedule that prints the wrong day is worse than no schedule.
 */
export function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Whether a game belongs on its tournament's schedule.
 *
 * Nothing in the schema ties a game's date to its tournament's range, and six
 * production games fall outside it — an August test game attached to a
 * November tournament. Printing those under the wrong heading is visibly wrong
 * to a parent, so they are excluded from the document. The games are never
 * modified, and the count is surfaced to the coach instead.
 *
 * A tournament missing a bound does not exclude anything on that side.
 */
export function isGameWithinTournament(gameDate, startDate, endDate) {
  if (!gameDate) return false;
  if (startDate && gameDate < startDate) return false;
  if (endDate && gameDate > endDate) return false;
  return true;
}

/**
 * Game order within a tournament: date, then start time with NULLS LAST, then
 * id for stability. A game with a recorded time can be placed in the day's
 * sequence; one without cannot, so it follows rather than leading.
 */
export function compareGames(a, b) {
  return (
    (a.date ?? "").localeCompare(b.date ?? "") ||
    (a.startTime == null) - (b.startTime == null) ||
    (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
    (a.id ?? "").localeCompare(b.id ?? "")
  );
}

/** Tournament order: start date, then name. */
export function compareTournaments(a, b) {
  return (
    (a.startDate ?? "").localeCompare(b.startDate ?? "") ||
    (a.name ?? "").localeCompare(b.name ?? "")
  );
}

/** "Aug 5–6, 2026" · "Nov 21, 2026" · "Dec 30, 2026 – Jan 2, 2027" */
export function formatDateRange(startIso, endIso) {
  const s = parseDate(startIso);
  const e = parseDate(endIso);
  if (!s) return null;

  const full = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (!e || +e === +s) return full(s);
  if (s.getFullYear() !== e.getFullYear()) return `${full(s)} – ${full(e)}`;
  if (s.getMonth() !== e.getMonth()) {
    return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
  }
  return `${MONTHS[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${e.getFullYear()}`;
}

/** "Wed Aug 5" */
export function formatDayLabel(iso) {
  const d = parseDate(iso);
  return d ? `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}` : null;
}

/** "9:00 AM". Null stays null — a missing time is never a placeholder. */
export function formatClock(time) {
  if (!time) return null;
  const [hRaw, m] = String(time).split(":");
  const h = Number(hRaw);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m ?? "00"} ${suffix}`;
}

/** Consecutive games sharing a date, so a multi-day event reads day by day. */
export function groupGamesByDate(games = []) {
  const out = [];
  for (const g of games) {
    const last = out[out.length - 1];
    if (last && last.date === g.date) last.games.push(g);
    else out.push({ date: g.date, games: [g] });
  }
  return out;
}

/**
 * The ordered parts of a location line, each appearing at most once.
 *
 * Previously assembled from independent conditionals in the template, two of
 * which could both be true for a free-text location — the result printed it
 * twice ("Panama City, FLPanama City, FL"). Expressed as one ordered list, the
 * duplicate is not merely fixed but unrepresentable.
 *
 * Rules, stated once:
 *   - the facility name leads when there is one
 *   - a full address REPLACES city/state, which it already contains
 *   - city/state appears only when there is no full address
 *
 * Returns [] when there is nothing to show, so the caller renders nothing
 * rather than an empty line.
 */
export function locationParts(place) {
  if (!place) return [];
  const parts = [];
  if (place.name) parts.push({ key: "name", text: place.name, kind: "name" });
  if (place.address) parts.push({ key: "address", text: place.address, kind: "address" });
  else if (place.area) parts.push({ key: "area", text: place.area, kind: "area" });
  return parts;
}
