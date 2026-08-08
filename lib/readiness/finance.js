import { action, collect, count } from "./contract";

/**
 * Finance Needs Action rules.
 *
 * MVP scope is outstanding player balances only. Overdue and due-soon alerts
 * are deliberately absent: payment_log.month_label is free text, not a date,
 * so there is no reliable due date to compare against. Those alerts wait for
 * a proper installment schedule model rather than being forced onto the
 * current structure.
 */

function outstandingCheck(payments) {
  const affected = payments.filter((p) => p.balance > 0);
  const total = affected.reduce((s, p) => s + p.balance, 0);
  return action({
    id: "outstanding",
    title: "Outstanding player balances",
    detail: `${count(affected.length, "player")} owing $${total.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`,
    affected,
    priority: 10,
  });
}

/** Nothing paid at all — worth separating from a partial balance. */
function notStartedCheck(payments) {
  const affected = payments.filter((p) => p.totalPaid === 0 && p.totalDue > 0);
  return action({
    id: "not-started",
    title: "No payments received",
    detail: `${count(affected.length, "player")} has not paid anything yet`,
    affected,
    priority: 20,
  });
}

export function financeActions(payments) {
  return collect([outstandingCheck(payments), notStartedCheck(payments)]);
}

export const FINANCE_FILTER_LABELS = {
  outstanding: "with an outstanding balance",
  "not-started": "who have not paid anything",
};
