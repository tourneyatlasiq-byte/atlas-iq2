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

/**
 * Active roster players with no dues obligation at all.
 *
 * Distinct from "no payments received": that player owes a known amount and
 * hasn't paid. This one has no amount set, so they are invisible in every dues
 * total — expected, collected and outstanding all silently exclude them.
 *
 * Highest priority of the three because it is a gap in the record rather than
 * a gap in collection.
 *
 * Pickups are excluded by construction: rosterPlayers comes from
 * team_season_players, which a pickup-only player has no row in.
 */
function missingDuesCheck(rosterPlayers = [], payments = []) {
  const withDues = new Set(payments.map((p) => p.player_id).filter(Boolean));
  const affected = rosterPlayers.filter((r) => !withDues.has(r.player_id));

  return action({
    id: "no-dues",
    title: "Player dues not set",
    detail:
      affected.length === 1
        ? `${affected[0].player?.full_name ?? "One player"} has no dues amount set`
        : `${count(affected.length, "player")} have no dues amount set`,
    affected,
    priority: 5,
  });
}

export function financeActions(payments, rosterPlayers = []) {
  return collect([
    missingDuesCheck(rosterPlayers, payments),
    outstandingCheck(payments),
    notStartedCheck(payments),
  ]);
}

export const FINANCE_FILTER_LABELS = {
  "no-dues": "with no dues amount set",
  outstanding: "with an outstanding balance",
  "not-started": "who have not paid anything",
};
