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

/**
 * Rounds to the nearest cent. Never floors, never truncates.
 *
 * EPSILON compensates for float representation: 1.005 is stored as
 * 1.00499999999999989, which would otherwise round down to 1.00.
 */
export function toCents(n) {
  return Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;
}

/** A money value as an exact integer number of cents. */
export function cents(n) {
  return Math.round((Number(n ?? 0) + Number.EPSILON) * 100);
}

/**
 * Sums money exactly.
 *
 * Adding floats accumulates error — 0.1 + 0.2 is 0.30000000000000004 — and a
 * season of transactions compounds it. Adding integer cents cannot drift, so
 * the conversion back to dollars happens once, at the end.
 */
export function sumMoney(values) {
  return values.reduce((total, v) => total + cents(v), 0) / 100;
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

  const recorded = sumMoney(
    transactions
      .filter((t) => t.tournament_id === tournament.id && isFinanciallyRecorded(t))
      .map((t) => t.actual_amount)
  );

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

  const looseCommitted = sumMoney(
    own
      .filter((t) => isFinanciallyRecorded(t) && !linkedIds.has(t.tournament_id))
      .map((t) => t.actual_amount)
  );

  const tournamentCommitted = sumMoney(
    linkedTournaments.map((t) => tournamentCommitment(t, own))
  );

  const planned = toCents(line.budgeted);
  const committed = sumMoney([looseCommitted, tournamentCommitted]);
  const paid = sumMoney(own.filter(isActual).map((t) => t.actual_amount));

  return {
    planned,
    committed,
    paid,
    // Subtracted in cents so Planned − Committed is exact.
    available: (cents(planned) - cents(committed)) / 100,
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
  if (!Number.isFinite(v)) return "—";

  // Stored as numeric(10,2), so a count of 15 arrives as "15.00". A quantity
  // is a count, not currency: 15 reads as 15, while a genuine 2.5 cases of
  // water keeps its decimal. Trailing zeros are dropped, not the value.
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(2)));
}

/**
 * Cash actually paid against tournaments this season.
 *
 * Was computed inline in the Finance component. Reporting needs the same
 * figure, and a report cannot run a React component — so it lives here, beside
 * the other derivations, and both callers read one implementation.
 *
 * Uses the shared Actual rule rather than restating it: paid means an amount
 * exists AND the status is Paid.
 */
export function tournamentPaidTotal(transactions = []) {
  return sumMoney(
    (transactions ?? [])
      .filter((t) => t.tournament_id && !t.is_income && isActual(t))
      .map((t) => t.actual_amount)
  );
}

/**
 * Percentage of expected dues collected, 0–100.
 *
 * Returns null when nothing is expected: no dues set is not "0% collected",
 * and a report must be able to tell those apart.
 */
export function duesCollectedPercent(dues) {
  if (!dues || !(dues.expected > 0)) return null;
  return Math.round((dues.collected / dues.expected) * 100);
}

/**
 * Total still owed across a set of player payment rows.
 *
 * Takes the rows rather than a readiness action so any caller — a screen, a
 * Player Dues Report, a statement — can pass whichever subset it holds.
 */
export function outstandingTotal(payments = []) {
  return sumMoney((payments ?? []).map((p) => p.balance ?? 0));
}
