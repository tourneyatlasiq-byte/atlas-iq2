import { registrationState, localToday } from "./tournament-status";

/**
 * The tournament drawer's one volt button: the next useful action.
 *
 * Pure, so the rules are tested without a screen. Returns { kind, label } or
 * null. Only commit, register and paid are performed by the existing quick
 * actions (components/QuickStatus.js); roster and game open the form further
 * down the drawer.
 *
 * Priority, for someone who can edit:
 *   Declined, or the event is over            nothing
 *   Considering                               Commit (never registration or payment)
 *   Waitlisted                                nothing: there is no place yet, so no
 *                                             registration, payment, roster or games to chase
 *   during the event                          Add game
 *   Not Registered                            Mark registered (records a status; this app
 *                                             does not register anyone anywhere)
 *   Registered / Deposit Paid, money owed     Mark paid in full (a cost or an unpaid entry exists)
 *   place held, roster empty, <= 14 days out  Set roster
 *   otherwise                                 nothing
 */
export const ROSTER_PROMPT_DAYS = 14;

const DAY = 86400000;
const at = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00`);

export function nextStep(t, { canWrite = false, today = localToday(), rosterCount = 0, payments = null } = {}) {
  if (!canWrite || !t || t.decision === "Declined") return null;
  const start = t.start_date ?? null;
  const end = t.end_date ?? start;
  if (end && end < today) return null;

  if (t.decision === "Considering") return { kind: "commit", label: "Commit" };

  const r = registrationState(t);
  if (r.waitlisted) return null;

  const during = Boolean(start) && start <= today && today <= end;
  if (during) return { kind: "game", label: "Add game" };

  if (!r.registered) return { kind: "register", label: "Mark registered" };

  const owed = payments && ((payments.remaining ?? 0) > 0 || (payments.toPayCount ?? 0) > 0);
  if (r.payable && owed) return { kind: "paid", label: "Mark paid in full" };

  if (rosterCount === 0 && start) {
    const days = Math.round((at(start) - at(today)) / DAY);
    if (days <= ROSTER_PROMPT_DAYS) return { kind: "roster", label: "Set roster" };
  }
  return null;
}
