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
  // What the club pays out to a league or governing body. Not to be confused
  // with Player Dues, which is what families pay the club and comes from
  // Player Payments — that direction is blocked as an income category below.
  "Organization Dues",
  "Subscriptions / Memberships",
  "Insurance",
  "Photography",
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


/* ---------------------------------------------------------------------------
   Commitment: what a budget line has been spoken for, whether or not paid.
   --------------------------------------------------------------------------- */

/**
 * A transaction that represents a real financial obligation.
 *
 * Ordered, Received and Paid all mean the money is spoken for. "Planned" does
 * not — it is a placeholder a coach uses while thinking, and counting it would
 * make a budget look consumed by ideas.
 *
 * Checked by status rather than by a null amount: Planned rows happen to have
 * no amount today, but nothing stops a coach entering one.
 */
export function isFinanciallyRecorded(txn) {
  return (
    txn.actual_amount != null &&
    (txn.status === "Ordered" || txn.status === "Received" || txn.status === "Paid")
  );
}

/** Cents, always. No truncation or whole-dollar rounding anywhere. */
export function toCents(n) {
  return Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;
}

/**
 * What one tournament commits from its budget line.
 *
 * The larger of its estimated price and what has actually been recorded
 * against it — never the sum. Fall Kickoff Classic costs $555 and has $495 +
 * $60 of paid transactions; adding them would report $1,110 committed for a
 * $555 event.
 *
 * Only Committed tournaments consume budget. Considering and Declined do not.
 */
export function tournamentCommitment(tournament, transactions = []) {
  if (tournament.decision !== "Committed") return 0;

  const recorded = transactions
    .filter((t) => t.tournament_id === tournament.id && isFinanciallyRecorded(t))
    .reduce((sum, t) => sum + Number(t.actual_amount), 0);

  return toCents(Math.max(Number(tournament.total_cost ?? 0), recorded));
}

/**
 * Planned / Committed / Paid / Available for one budget line.
 *
 * Available is deliberately NOT called Remaining. Remaining already meant
 * Planned minus Paid; renaming it in place would silently change a number the
 * coach already reads.
 *
 *   Paid is a subset of Committed, never added to it.
 *   Available = Planned − Committed
 */
export function budgetLineFinance(line, transactions = [], tournaments = []) {
  const own = transactions.filter((t) => t.budget_item_id === line.id);

  // A tournament's own transactions are already inside its commitment, so
  // counting them again here would double-count.
  const linkedTournaments = tournaments.filter(
    (t) => t.budget_item_id === line.id && t.decision === "Committed"
  );
  const linkedIds = new Set(linkedTournaments.map((t) => t.id));

  const looseCommitted = own
    .filter((t) => isFinanciallyRecorded(t) && !linkedIds.has(t.tournament_id))
    .reduce((s, t) => s + Number(t.actual_amount), 0);

  const tournamentCommitted = linkedTournaments.reduce(
    (s, t) => s + tournamentCommitment(t, own),
    0
  );

  const planned = toCents(line.budgeted);
  const committed = toCents(looseCommitted + tournamentCommitted);
  const paid = toCents(
    own.filter(isActual).reduce((s, t) => s + Number(t.actual_amount), 0)
  );

  return {
    planned,
    committed,
    paid,
    available: toCents(planned - committed),
    percentCommitted: planned > 0 ? Math.round((committed / planned) * 100) : null,
  };
}


/**
 * Currency, always to the cent.
 *
 * Three components each had their own copy rounding to whole dollars, so a
 * uniform line of 16 x $119.99 displayed as $1,920 while storing $1,919.84.
 * Once a coach is entering real unit costs, the pennies are the point.
 */
export function money(n) {
  if (n == null || n === "") return "—";
  return `$${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Quantity is a count, not currency: 16 stays 16, but 2.5 stays 2.5. */
export function quantity(n) {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : String(v);
}
