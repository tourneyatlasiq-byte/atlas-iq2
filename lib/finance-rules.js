/**
 * Pure Finance rules and vocabulary.
 *
 * Deliberately free of any server import (no next/headers, no Supabase client)
 * so both server queries and client components can import from here. This is
 * the single home for the Actual rule — it must not be reimplemented anywhere.
 */

export const TXN_STATUSES = ["Planned", "Ordered", "Received", "Paid"];

/** Standardized suggestions. Additional categories are allowed. */
/**
 * Income categories that may NOT be entered as transactions.
 *
 * Player dues are already recorded in Player Payments and derive from
 * payment_log. Allowing a "Player Dues" transaction would double-count every
 * payment and force two records to be kept in step.
 */
export const BLOCKED_INCOME_CATEGORIES = ["Player Dues"];

export const isBlockedIncomeCategory = (c) =>
  BLOCKED_INCOME_CATEGORIES.some((b) => b.toLowerCase() === (c ?? "").trim().toLowerCase());

export const CATEGORIES = [
  "Tournament Fees",
  "Player Uniforms",
  "Equipment",
  "Field / Facility Costs",
  "Team Fees & Administration",
  "Coaches",
  "Team Building",
  "Fundraising",
  "Sponsors",
  "Other",
];

/**
 * THE ACTUAL RULE, used everywhere in Finance.
 *
 * A transaction counts toward Actual only when it has a real amount AND
 * represents completed financial activity. "Paid" is the only status that
 * unambiguously means money moved — Ordered and Received are procurement
 * states, and a received net-30 invoice is goods in hand with money unspent.
 */
export function isActual(txn) {
  return txn.actual_amount != null && txn.status === "Paid";
}

/**
 * Ordered or Received with a real amount: money is committed but not yet
 * spent. Reported separately so nothing becomes invisible.
 */
export function isCommittedUnpaid(txn) {
  return txn.actual_amount != null && (txn.status === "Ordered" || txn.status === "Received");
}
