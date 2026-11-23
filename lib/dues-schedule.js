/**
 * Player dues schedules: the one set of rules (2026-11).
 *
 * Everything the Finance screens, the player sheet and the team summary say
 * about "due", "past due" and "next payment" comes from this file, so no
 * screen can compute a slightly different answer. It is pure: no database, no
 * clock. The caller passes "today" (the device's calendar date, see
 * components/useDeviceToday.js). Money is integer cents throughout.
 *
 * THE MODEL
 *   Payments are one pool, never attached to an installment in storage.
 *   Credited money is applied to installments oldest first, here, for display.
 *   One pool and one formula means money cannot be counted twice, however it
 *   arrives: early, partial, split or in one piece.
 *
 *   Past due     unpaid amount on installments dated BEFORE today.
 *   Due by today unpaid amount on installments dated today or earlier, so an
 *                installment due today is due, and is past due the next day.
 *   Next         the first installment dated today or later that still has an
 *                unpaid amount (an unpaid installment due today is the next
 *                one). It is always reported separately from anything overdue.
 *
 * A player with no schedule is never reported past due. A schedule that does
 * not add up to the player's dues is reported as such, never trusted.
 *
 * Dates are plain YYYY-MM-DD strings, compared as strings.
 */

/**
 * The team schedule is a list of exact dates and dollar amounts, never percentages:
 * [{ dueDate, amountCents }]. It fits a player only when the player's total dues equal
 * the schedule's total; anyone else gets an individual schedule.
 */
export const templateTotalCents = (items) => (items ?? []).reduce((s, i) => s + i.amountCents, 0);
export const templateFitsPlayer = (items, playerTotalCents) => (items ?? []).length > 0 && templateTotalCents(items) === playerTotalCents;

/** Most installments one player may have. */
export const MAX_INSTALLMENTS = 24;

const byDate = (a, b) => a.dueDate.localeCompare(b.dueDate) || (a.position ?? 0) - (b.position ?? 0);

/** Applies credited cents to installments, oldest first. */
export function allocateCredits(installments, creditedCents) {
  let credit = Math.max(0, creditedCents ?? 0);
  return [...(installments ?? [])].sort(byDate).map((i) => {
    const paidCents = Math.min(i.amountCents, credit);
    credit -= paidCents;
    return { ...i, paidCents, remainingCents: i.amountCents - paidCents };
  });
}

/**
 * Where one player stands.
 *
 * status: exempt | no-dues | no-schedule | schedule-mismatch | paid | loading |
 *         past-due | due-today | on-track
 * "loading" means the device date is not known yet. Nothing date-based is
 * claimed until it is.
 */
export function duesStanding({ totalCents, creditedCents, exempt, installments, today }) {
  const total = totalCents ?? 0;
  const credited = creditedCents ?? 0;
  const base = {
    totalCents: total,
    creditedCents: credited,
    remainingCents: Math.max(0, total - credited),
    overpaidCents: Math.max(0, credited - total),
    hasSchedule: false,
    rows: [],
    dueByTodayCents: 0,
    pastDueCents: 0,
    oldestPastDueDate: null,
    nextScheduled: null,
    mismatchCents: 0,
  };

  if (exempt) return { ...base, status: "exempt" };
  if (total <= 0) return { ...base, status: "no-dues" };
  const list = installments ?? [];
  if (list.length === 0) return { ...base, status: "no-schedule" };

  const rows = allocateCredits(list, credited);
  const scheduled = list.reduce((s, i) => s + i.amountCents, 0);
  const withSchedule = { ...base, hasSchedule: true, mismatchCents: scheduled - total };

  const known = today != null;
  const stateOf = (r) => {
    if (r.remainingCents <= 0) return "paid";
    if (!known) return "unknown";
    if (r.dueDate < today) return "past-due";
    if (r.dueDate === today) return "due-today";
    return "upcoming";
  };
  const shown = rows.map((r) => ({ ...r, state: stateOf(r), partial: r.paidCents > 0 && r.remainingCents > 0 }));

  if (scheduled !== total) return { ...withSchedule, rows: shown, status: "schedule-mismatch" };
  if (credited >= total) return { ...withSchedule, rows: shown, status: "paid" };
  if (!known) return { ...withSchedule, rows: shown, dueByTodayCents: null, pastDueCents: null, status: "loading" };

  const unpaid = shown.filter((r) => r.remainingCents > 0);
  const pastDue = unpaid.filter((r) => r.dueDate < today);
  const dueByToday = unpaid.filter((r) => r.dueDate <= today);
  const next = unpaid.find((r) => r.dueDate >= today) ?? null;
  const pastDueCents = pastDue.reduce((s, r) => s + r.remainingCents, 0);
  const dueByTodayCents = dueByToday.reduce((s, r) => s + r.remainingCents, 0);

  return {
    ...withSchedule,
    rows: shown,
    pastDueCents,
    dueByTodayCents,
    oldestPastDueDate: pastDue[0]?.dueDate ?? null,
    nextScheduled: next ? { amountCents: next.remainingCents, dueDate: next.dueDate, dueToday: next.dueDate === today } : null,
    status: pastDueCents > 0 ? "past-due" : dueByTodayCents > 0 ? "due-today" : "on-track",
  };
}

/** Team figures from a list of duesStanding results. */
export function summarizeDues(standings) {
  const list = standings ?? [];
  const ready = !list.some((s) => s.status === "loading");
  const out = { ready, pastDueCount: 0, pastDueCents: 0, dueTodayCount: 0, dueTodayCents: 0, noScheduleCount: 0 };
  if (!ready) return out;
  for (const s of list) {
    if (s.status === "past-due") { out.pastDueCount += 1; out.pastDueCents += s.pastDueCents; }
    if (s.nextScheduled?.dueToday) { out.dueTodayCount += 1; out.dueTodayCents += s.nextScheduled.amountCents; }
    if (s.status === "no-schedule") out.noScheduleCount += 1;
  }
  return out;
}

/** "$1,100.50" or "1100" to cents; null when it is not money. */
export const parseDollarsToCents = (v) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (s === "" || !/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
};

/**
 * The schedule editor's own check. The database refuses anything this lets
 * through; this exists so the person sees why before pressing Save.
 */
export function validateScheduleDraft({ totalCents, paidCents, rows }) {
  const errors = [];
  const parsed = (rows ?? []).map((r) => ({ dueDate: String(r.dueDate ?? ""), amountCents: parseDollarsToCents(r.amount) }));
  if (totalCents < (paidCents ?? 0)) errors.push("total-below-paid");
  if (parsed.length > MAX_INSTALLMENTS) errors.push("too-many");
  if (parsed.some((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.dueDate))) errors.push("missing-date");
  if (parsed.some((r) => r.amountCents == null || r.amountCents <= 0)) errors.push("bad-amount");
  const dates = parsed.map((r) => r.dueDate).filter(Boolean);
  if (new Set(dates).size !== dates.length) errors.push("duplicate-date");
  const sumCents = parsed.reduce((s, r) => s + (r.amountCents ?? 0), 0);
  const diffCents = parsed.length === 0 ? 0 : sumCents - totalCents;
  if (diffCents !== 0) errors.push("total-mismatch");
  return { ok: errors.length === 0, errors, sumCents, diffCents, rows: parsed };
}

/**
 * Milliseconds until a moment just after the next local midnight, so a screen
 * left open overnight re-reads the date. Capped at the browser timer limit.
 */
export function nextMidnightDelayMs(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.min(next.getTime() - now.getTime() + 1000, 2 ** 31 - 1);
}
