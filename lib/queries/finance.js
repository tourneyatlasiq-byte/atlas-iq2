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
      const paid = (p.log ?? []).reduce((s, l) => s + Number(l.amount ?? 0), 0);
      const due = Number(p.initial_cost ?? 0);
      const balance = due - paid;
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
  return (data ?? []).reduce((s, t) => s + Number(t.total_cost ?? 0), 0);
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
      const budgeted = rows.reduce((s, r) => s + r.budgeted, 0);
      const actual = rows.reduce((s, r) => s + r.actual, 0);
      const committedTotal = toCents(rows.reduce((s, r) => s + r.committedTotal, 0));
      return {
        category,
        rows,
        budgeted,
        actual,
        committedTotal,
        paidTotal: actual,
        available: toCents(budgeted - committedTotal),
        percentCommitted: budgeted > 0 ? Math.round((committedTotal / budgeted) * 100) : null,
        committed: rows.reduce((s, r) => s + r.committed, 0),
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
  const dues = payments.reduce((s, p) => s + p.totalPaid, 0);

  const income = transactions.filter((t) => t.is_income && isActual(t));
  const byCategory = (name) =>
    income
      .filter((t) => (t.budget_item?.category ?? t.category) === name)
      .reduce((s, t) => s + Number(t.actual_amount), 0);

  const fundraising = byCategory("Fundraising");
  const sponsors = byCategory("Sponsors");

  // Income budget lines are targets, not expenses. They belong here with what
  // was actually received, not in the expense budget.
  const goalFor = (name) =>
    budgetItems
      .filter((b) => b.is_income && b.category === name)
      .reduce((s2, b) => s2 + Number(b.budgeted ?? 0), 0);

  const fundraisingGoal = goalFor("Fundraising");
  const sponsorsGoal = goalFor("Sponsors");
  const totalGoal = budgetItems
    .filter((b) => b.is_income)
    .reduce((s2, b) => s2 + Number(b.budgeted ?? 0), 0);

  // Anything income-flagged outside the two known categories still counts
  // toward the total, so the figures cannot silently disagree.
  const other =
    income.reduce((s, t) => s + Number(t.actual_amount), 0) - fundraising - sponsors;

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
  const expected = payments.reduce((s, p) => s + p.totalDue, 0);
  const collected = payments.reduce((s, p) => s + p.totalPaid, 0);
  return {
    expected,
    collected,
    outstanding: expected - collected,
    outstandingCount: payments.filter((p) => p.balance > 0).length,
  };
}

export function financeSummary(budget, transactions, payments) {
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

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

  return {
    budgetedExpenses,
    actualExpenses,
    committedUnpaid,
    committedExpenses,
    availableBudget,
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
