import { createClient } from "../supabase/server";
import { isActual, isCommittedUnpaid, budgetLineFinance, toCents, sumMoney } from "../finance-rules";

export {
  isActual,
  isCommittedUnpaid,
  CATEGORIES,
  TXN_STATUSES,
  BLOCKED_INCOME_CATEGORIES,
  isBlockedIncomeCategory,
} from "../finance-rules";

export async function listBudgetItems(seasonId) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("budget_items")
    .select("id, category, name, budgeted, quantity, unit_cost, is_income, notes")
    .eq("season_id", seasonId)
    .order("category")
    .order("name");
  if (error) throw new Error(`Could not load the budget: ${error.message}`);
  return data ?? [];
}

export async function listTransactions(seasonId) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("budget_transactions")
    .select(
      `id, txn_date, vendor, item, category, quantity, actual_amount, status,
       is_income, notes, budget_item_id, tournament_id, player_id, facility_id,
       budget_item:budget_items ( id, category, name, is_income ),
       tournament:tournaments ( id, name ),
       player:players ( id, full_name ),
       facility:facilities ( id, name )`
    )
    .eq("season_id", seasonId)
    .order("txn_date", { ascending: false });
  if (error) throw new Error(`Could not load transactions: ${error.message}`);
  return data ?? [];
}

export async function listPlayerPayments(seasonId) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("player_payments")
    .select(
      `id, initial_cost, player_id,
       player:players ( id, full_name, person_type ),
       log:payment_log ( id, month_label, amount, paid_date )`
    )
    .eq("season_id", seasonId);
  if (error) throw new Error(`Could not load player payments: ${error.message}`);

  return (data ?? [])
    .map((p) => {
      // Cents throughout: this balance drives "owes", "paid in full" and the
      // dues totals above, so a float remainder here would misclassify a
      // player who has actually paid in full.
      const paid = sumMoney((p.log ?? []).map((l) => l.amount ?? 0));
      const due = toCents(p.initial_cost ?? 0);
      const balance = sumMoney([due, -paid]);
      return {
        ...p,
        totalDue: due,
        totalPaid: paid,
        balance,
        status: balance <= 0 ? "Paid in Full" : paid > 0 ? "Partial" : "Not Started",
        // Newest first — the most recent payment is what a coach checks.
        log: [...(p.log ?? [])].sort((a, b) => (b.paid_date ?? "").localeCompare(a.paid_date ?? "")),
      };
    })
    .sort((a, b) => (a.player?.full_name ?? "").localeCompare(b.player?.full_name ?? ""));
}

/** Committed tournament cost, for the reconciliation line. Informational only. */
export async function committedTournamentCost(seasonId) {
  const supabase = createClient();
  const { data } = await supabase
    .from("tournaments")
    .select("total_cost")
    .eq("season_id", seasonId)
    .eq("decision", "Committed");
  return sumMoney((data ?? []).map((t) => t.total_cost ?? 0));
}

/**
 * Rolls transactions up against budget lines.
 *
 * The linked budget item is authoritative for category. budget_transactions
 * .category is only consulted for unlinked rows.
 */
export function buildBudget(items, transactions, tournaments = []) {
  const byItem = new Map();
  for (const t of transactions) {
    if (!t.budget_item_id) continue;
    const cur = byItem.get(t.budget_item_id) ?? { actual: 0, committed: 0 };
    if (isActual(t)) cur.actual += Number(t.actual_amount);
    else if (isCommittedUnpaid(t)) cur.committed += Number(t.actual_amount);
    byItem.set(t.budget_item_id, cur);
  }

  const lines = items.map((i) => {
    const roll = byItem.get(i.id) ?? { actual: 0, committed: 0 };
    const budgeted = Number(i.budgeted ?? 0);
    const fin = budgetLineFinance(i, transactions, tournaments);
    return {
      ...i,
      budgeted,
      committedTotal: fin.committed,
      available: fin.available,
      percentCommitted: fin.percentCommitted,
      quantity: i.quantity == null ? null : Number(i.quantity),
      unitCost: i.unit_cost == null ? null : Number(i.unit_cost),
      actual: roll.actual,
      committed: roll.committed,
      // To Pay: committed money that has not yet been paid. Derived, never a
      // new rule — paid is already inside committed, so this is the remainder.
      toPay: sumMoney([fin.committed, -roll.actual]),
      remaining: budgeted - roll.actual,
      variance: roll.actual - budgeted,
      percentUsed: budgeted > 0 ? Math.round((roll.actual / budgeted) * 100) : null,
    };
  });

  const group = (isIncome) => {
    const relevant = lines.filter((l) => Boolean(l.is_income) === isIncome);
    const cats = [...new Set(relevant.map((l) => l.category))].sort();
    return cats.map((category) => {
      const rows = relevant.filter((l) => l.category === category);
      const budgeted = sumMoney(rows.map((r) => r.budgeted));
      const actual = sumMoney(rows.map((r) => r.actual));
      const committedTotal = sumMoney(rows.map((r) => r.committedTotal));
      return {
        category,
        rows,
        budgeted,
        actual,
        committedTotal,
        paidTotal: actual,
        toPay: sumMoney([committedTotal, -actual]),
        available: toCents(budgeted - committedTotal),
        percentCommitted: budgeted > 0 ? Math.round((committedTotal / budgeted) * 100) : null,
        committed: sumMoney(rows.map((r) => r.committed)),
        remaining: budgeted - actual,
        variance: actual - budgeted,
        percentUsed: budgeted > 0 ? Math.round((actual / budgeted) * 100) : null,
      };
    });
  };

  // Transactions with no budget line still count toward season totals.
  const unlinked = transactions.filter((t) => !t.budget_item_id);

  return { expenses: group(false), income: group(true), unlinked };
}

/**
 * Funds In.
 *
 * Player dues derive from payment_log — the same records shown in Player
 * Payments — and are never entered as transactions. Everything else comes from
 * income transactions.
 *
 * Deliberately kept apart from expenses: these are two true figures that sit
 * side by side, not two halves of a net position.
 */
export function fundsIn(transactions, payments, budgetItems = []) {
  // Cents throughout. Category matching, inclusion and the residual "other"
  // are deliberately unchanged — this is an arithmetic fix, not a rule change.
  const dues = sumMoney(payments.map((p) => p.totalPaid));

  const income = transactions.filter((t) => t.is_income && isActual(t));
  const byCategory = (name) =>
    sumMoney(
      income
        .filter((t) => (t.budget_item?.category ?? t.category) === name)
        .map((t) => t.actual_amount)
    );

  const fundraising = byCategory("Fundraising");
  const sponsors = byCategory("Sponsors");

  // Income budget lines are targets, not expenses. They belong here with what
  // was actually received, not in the expense budget.
  const goalFor = (name) =>
    sumMoney(
      budgetItems.filter((b) => b.is_income && b.category === name).map((b) => b.budgeted ?? 0)
    );

  const fundraisingGoal = goalFor("Fundraising");
  const sponsorsGoal = goalFor("Sponsors");
  const totalGoal = sumMoney(budgetItems.filter((b) => b.is_income).map((b) => b.budgeted ?? 0));

  // Anything income-flagged outside the two known categories still counts
  // toward the total, so the figures cannot silently disagree.
  const other = sumMoney([
    sumMoney(income.map((t) => t.actual_amount)),
    -fundraising,
    -sponsors,
  ]);

  return {
    playerDues: dues,
    fundraising,
    fundraisingGoal,
    sponsors,
    sponsorsGoal,
    other,
    otherGoal: Math.max(0, totalGoal - fundraisingGoal - sponsorsGoal),
    totalGoal,
    otherTotal: fundraising + sponsors + other,
    total: dues + fundraising + sponsors + other,
  };
}

/** Dues expected, received and outstanding — the two halves of one number. */
export function duesSummary(payments) {
  // Integer cents, not float addition. Whole-dollar dues hid the drift, but
  // 33.33 + 33.33 + 33.33 is 99.99000000000001 in binary floating point, and
  // that lands on a parent-facing figure. Same inputs, same inclusions —
  // only the addition changed.
  const expected = sumMoney(payments.map((p) => p.totalDue));
  const collected = sumMoney(payments.map((p) => p.totalPaid));
  return {
    expected,
    collected,
    outstanding: sumMoney([expected, -collected]),
    outstandingCount: payments.filter((p) => p.balance > 0).length,
  };
}

export function financeSummary(budget, transactions, payments) {
  // Cents. `sum` remains only for counts, never for money.
  const sum = (arr, f) => sumMoney(arr.map(f));

  const budgetedExpenses = sum(budget.expenses, (g) => g.budgeted);
  const budgetedIncome = sum(budget.income, (g) => g.budgeted);

  const actualExpenses = sum(
    transactions.filter((t) => !t.is_income && isActual(t)),
    (t) => Number(t.actual_amount)
  );
  const actualIncome = sum(
    transactions.filter((t) => t.is_income && isActual(t)),
    (t) => Number(t.actual_amount)
  );
  const committedUnpaid = sum(
    transactions.filter((t) => !t.is_income && isCommittedUnpaid(t)),
    (t) => Number(t.actual_amount)
  );

  const outstanding = sum(
    payments.filter((p) => p.balance > 0),
    (p) => p.balance
  );

  // Committed and Available come from the same per-category figures the Budget
  // view renders, so Home and Finance cannot report different numbers for the
  // same idea. Recomputing them here from raw transactions is how they drifted
  // in the first place: this summary said budgeted - paid, while Finance said
  // Planned - Committed.
  const committedExpenses = sumMoney(budget.expenses.map((g) => g.committedTotal ?? 0));
  const availableBudget = sumMoney([budgetedExpenses, -committedExpenses]);

  /**
   * Budget = Paid + To Pay + Available.
   *
   * Paid is a subset of committed, never added to it, so To Pay is the
   * committed remainder. This makes the three figures mutually exclusive for
   * display without altering either underlying rule.
   */
  const toPay = sumMoney([committedExpenses, -actualExpenses]);

  return {
    budgetedExpenses,
    actualExpenses,
    committedUnpaid,
    committedExpenses,
    availableBudget,
    toPay,
    percentCommitted:
      budgetedExpenses > 0 ? Math.round((committedExpenses / budgetedExpenses) * 100) : null,
    // Retained: still read by app/review. Deliberately not what Home shows.
    remainingBudget: budgetedExpenses - actualExpenses,
    budgetedIncome,
    actualIncome,
    outstanding,
    outstandingCount: payments.filter((p) => p.balance > 0).length,
  };
}

/**
 * Committed tournaments with no budget line.
 *
 * These are real obligations that no budget category reflects: buildBudget can
 * only reach a tournament through budget_item_id, so an unassigned one never
 * reduces any category's Available. Reported so the gap is visible and fixable
 * rather than absorbed silently into the totals.
 */
export function unassignedTournamentCommitments(tournaments = []) {
  return (tournaments ?? [])
    .filter(
      (t) =>
        t.decision === "Committed" &&
        !t.budget_item_id &&
        Number(t.total_cost ?? 0) > 0
    )
    .map((t) => ({ id: t.id, name: t.name, amount: toCents(Number(t.total_cost ?? 0)) }))
    .sort((a, b) => b.amount - a.amount || (a.name ?? "").localeCompare(b.name ?? ""));
}
