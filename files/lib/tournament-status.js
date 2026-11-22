import { sumMoney, isActual, isCommittedUnpaid } from "./finance-rules";

/**
 * Tournament registration and payment: one vocabulary for every screen.
 *
 * Pure, so server actions and client components share it. The database check
 * (tournaments_paid_status_check) allows exactly these five values. Two lists
 * had drifted: the tournament form offered Waitlisted, lib/queries/tournaments
 * exported a four-value list without it. This is now the only list.
 */
export const DECISIONS = ["Considering", "Committed", "Declined"];
export const PAID_STATUSES = ["Not Registered", "Waitlisted", "Registered", "Deposit Paid", "Paid in Full"];
export const PAID_IN_FULL = "Paid in Full";

/** Small predicates over paid_status, used by the server actions and the screens. */
export const isRegistered = (paidStatus) => paidStatus === "Registered" || paidStatus === "Deposit Paid" || paidStatus === PAID_IN_FULL;
export const isWaitlisted = (paidStatus) => paidStatus === "Waitlisted";
export const isPaidInFull = (paidStatus) => paidStatus === PAID_IN_FULL;
/** From these statuses "Mark paid in full" makes sense: a place is held and it is not yet settled. */
export const canMarkPaidInFull = (paidStatus) => paidStatus === "Registered" || paidStatus === "Deposit Paid";
/** From these statuses "Mark registered" makes sense. */
export const canMarkRegistered = (paidStatus) => paidStatus === "Not Registered" || paidStatus === "Waitlisted";
export const isValidPaidStatus = (v) => PAID_STATUSES.includes(v);
export const isValidDecision = (v) => DECISIONS.includes(v);

/** Today as the user's own calendar date (not UTC, which is already tomorrow on a US evening). */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Where entry stands, in the order a coach acts on it.
 *
 * Waitlisted is its own state: the coach has applied, so it is not "not
 * registered", but there is no confirmed place, so it is not registered and
 * there is nothing to pay. This matches lib/readiness/tournaments.js, which
 * excludes Waitlisted from the registration and payment checks and raises a
 * waitlist check instead.
 */
export function registrationState(t) {
  switch (t?.paid_status) {
    case "Paid in Full": return { registered: true, label: "Registered", payable: false, step: 3 };
    case "Deposit Paid": return { registered: true, label: "Registered", payable: true, step: 2.5 };
    case "Registered": return { registered: true, label: "Registered", payable: true, step: 2 };
    case "Waitlisted": return { registered: false, label: "Waitlisted", payable: false, step: 1, waitlisted: true };
    default: return { registered: false, label: "Not registered", payable: false, step: 1 };
  }
}

/**
 * What Finance has recorded against a tournament.
 *
 * There is no deposit amount column: a deposit is whatever Paid expense
 * transactions are linked to the tournament. Income never counts. The remaining
 * figure is what "Mark paid in full" would record, never below zero.
 */
export function tournamentPayments(t, transactions = []) {
  const linked = (transactions ?? []).filter((x) => x.tournament_id === t?.id && !x.is_income);
  const paid = sumMoney(linked.filter(isActual).map((x) => x.actual_amount));
  const toPay = sumMoney(linked.filter(isCommittedUnpaid).map((x) => x.actual_amount));
  const cost = t?.total_cost == null ? null : Number(t.total_cost);
  const remaining = cost == null ? null : Math.max(0, sumMoney([cost, -paid]));
  // The unpaid (To Pay) entries themselves, oldest first, so "Mark paid in full"
  // can mark one of them paid instead of recording the money a second time.
  const toPayEntries = linked
    .filter(isCommittedUnpaid)
    .map((x) => ({ id: x.id, amount: Number(x.actual_amount ?? 0), txn_date: x.txn_date ?? null, budget_item_id: x.budget_item_id ?? null }))
    .sort((a, b) => String(a.txn_date).localeCompare(String(b.txn_date)) || String(a.id).localeCompare(String(b.id)));
  return { cost, paid, toPay, remaining, toPayCount: toPayEntries.length, toPayEntries };
}

/**
 * The one quick action a row offers, or null.
 *
 * Past, Declined and finished tournaments offer nothing. Paid in Full is done.
 */
export function quickAction(t, today = localToday()) {
  if (!t || t.decision === "Declined") return null;
  if ((t.end_date ?? t.start_date ?? "") < today) return null;
  if (t.decision === "Considering") return { kind: "commit", label: "Commit" };
  const r = registrationState(t);
  if (!r.registered) return { kind: "register", label: r.waitlisted ? "Got a spot? Mark registered" : "Mark registered" };
  if (r.payable) return { kind: "paid", label: "Mark paid in full" };
  return null;
}

/** One line for a row: decision, registration and payment together. */
export function statusLine(t, transactions = []) {
  if (t.decision === "Considering") {
    // Registration is its own field. Showing it keeps "Considering" from hiding a Waitlisted or Registered value.
    const reg = t.paid_status && t.paid_status !== "Not Registered" ? ` · ${t.paid_status}` : "";
    return { main: "Considering", sub: `Not in Budget${reg}`, tone: "maybe" };
  }
  if (t.decision === "Declined") return { main: "Declined", sub: "", tone: "none" };
  const r = registrationState(t);
  const p = tournamentPayments(t, transactions);
  if (r.waitlisted) return { main: "Waitlisted", sub: "nothing to pay yet", tone: "wait" };
  if (!r.registered) return { main: "Committed", sub: "not registered", tone: "due" };
  if (t.paid_status === "Paid in Full") return { main: "Paid in full", sub: "", tone: "good" };
  const left = p.remaining;
  if (t.paid_status === "Deposit Paid") {
    return { main: "Deposit paid", sub: left == null ? "cost not set" : p.paid > 0 ? `${fmt(left)} to pay` : "amount not recorded in Finance", tone: "part" };
  }
  return { main: "Registered", sub: left == null ? "cost not set" : `${fmt(left)} to pay`, tone: "due" };
}

function fmt(n) {
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
