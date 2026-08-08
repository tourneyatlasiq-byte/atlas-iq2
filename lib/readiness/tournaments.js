import { action, collect, count } from "./contract";

/**
 * Tournament IQ Needs Action rules, on the shared contract.
 *
 * Previously these lived in lib/queries/tournaments.js as deriveActions(),
 * returning a bespoke shape. Retrofitted so Atlas has one pattern rather than
 * two implementations that drift.
 *
 * These checks have genuine deadlines, which is the case dueDate exists for.
 */

const daysUntil = (d, today) =>
  d ? Math.ceil((new Date(d + "T00:00:00") - today) / 86400000) : null;

/**
 * Committed, registration deadline close, still not registered.
 *
 * Waitlisted is excluded throughout this file: the coach has already applied,
 * so telling them to register is noise. Their real risk is covered by
 * waitlistCheck below.
 */
function deadlineCheck(rows, today) {
  const affected = rows.filter((t) => {
    if (t.decision !== "Committed" || t.paid_status !== "Not Registered") return false;
    const d = daysUntil(t.registration_deadline, today);
    return d !== null && d >= 0 && d <= 14;
  });

  const soonest = affected
    .map((t) => daysUntil(t.registration_deadline, today))
    .sort((a, b) => a - b)[0];

  return action({
    id: "deadline",
    title: "Registration closing",
    detail:
      affected.length === 1
        ? `${affected[0].name} closes in ${count(soonest, "day")}`
        : `${count(affected.length, "tournament")} closing within two weeks`,
    affected,
    priority: 10,
    dueDate: affected[0]?.registration_deadline ?? null,
  });
}

/** Committed but registration not started, with no imminent deadline. */
function unregisteredCheck(rows, today) {
  const affected = rows.filter((t) => {
    if (t.decision !== "Committed" || t.paid_status !== "Not Registered") return false;
    const start = daysUntil(t.start_date, today);
    if (start === null || start < 0) return false;
    const d = daysUntil(t.registration_deadline, today);
    return !(d !== null && d >= 0 && d <= 14);
  });

  return action({
    id: "unregistered",
    title: "Not registered",
    detail: `${count(affected.length, "committed tournament")} not registered yet`,
    affected,
    priority: 20,
  });
}

/**
 * Starting soon and not paid in full.
 *
 * Waitlisted is excluded: there is nothing to pay for until a place is
 * confirmed.
 */
function paymentCheck(rows, today) {
  const affected = rows.filter((t) => {
    if (t.decision !== "Committed") return false;
    if (
      t.paid_status === "Paid in Full" ||
      t.paid_status === "Not Registered" ||
      t.paid_status === "Waitlisted"
    ) return false;
    const start = daysUntil(t.start_date, today);
    return start !== null && start >= 0 && start <= 30;
  });

  return action({
    id: "payment",
    title: "Payment outstanding",
    detail: `${count(affected.length, "tournament")} starting soon and not paid in full`,
    affected,
    priority: 30,
    dueDate: affected[0]?.start_date ?? null,
  });
}

/**
 * Committed and waitlisted with the event close.
 *
 * The risk is not that registration was forgotten — it is that a date is being
 * held for an event that may never happen, while the window to book an
 * alternative closes. Priority 15 puts it above a general "not registered"
 * but below a hard deadline.
 */
function waitlistCheck(rows, today) {
  const affected = rows.filter((t) => {
    if (t.decision !== "Committed" || t.paid_status !== "Waitlisted") return false;
    const start = daysUntil(t.start_date, today);
    return start !== null && start >= 0 && start <= 21;
  });

  return action({
    id: "waitlist",
    title: "Waitlist unresolved",
    detail: `${count(affected.length, "tournament")} still waitlisted and starting soon`,
    affected,
    priority: 15,
    dueDate: affected[0]?.start_date ?? null,
  });
}

/** Still undecided with the event approaching. */
function decisionCheck(rows, today) {
  const affected = rows.filter((t) => {
    if (t.decision !== "Considering") return false;
    const start = daysUntil(t.start_date, today);
    return start !== null && start >= 0 && start <= 21;
  });

  return action({
    id: "decision",
    title: "Decision needed",
    detail: `${count(affected.length, "tournament")} starting within three weeks`,
    affected,
    priority: 40,
    dueDate: affected[0]?.start_date ?? null,
  });
}

export function tournamentActions(rows, today = new Date()) {
  return collect([
    deadlineCheck(rows, today),
    waitlistCheck(rows, today),
    unregisteredCheck(rows, today),
    paymentCheck(rows, today),
    decisionCheck(rows, today),
  ]);
}

export const TOURNAMENT_FILTER_LABELS = {
  deadline: "with registration closing",
  waitlist: "still waitlisted",
  unregistered: "not registered yet",
  payment: "with payment outstanding",
  decision: "awaiting a decision",
};
