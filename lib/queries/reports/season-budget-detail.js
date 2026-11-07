import { createClient } from "../../supabase/server";
import {
  buildBudget,
  financeSummary,
  listBudgetItems,
  listTransactions,
  listPlayerPayments,
  unassignedTournamentCommitments,
} from "../finance";
import {
  isActual,
  isFinanciallyRecorded,
  tournamentRemainder,
  sumMoney,
  toCents,
} from "../../finance-rules";

/**
 * Season Budget Detail — the parent-facing Detailed variant (2026-11).
 *
 * ALLOWLIST, NOT A FILTER, exactly like the Summary payload. Every value
 * returned is constructed here. Transactions are read in full only so the
 * Finance rules can run; what reaches the page is limited to:
 *
 *   - category: name, Budget, Paid, To Pay, Remaining, Committed
 *   - expense row: date, description, amount, Paid/To Pay
 *   - tournament row: dates, name, amount, Paid / Part paid / To Pay
 *   - aggregated rows: "Player-specific costs", "Other category costs"
 *   - uncategorized committed tournaments: dates, name, outstanding amount
 *   - season figures
 *
 * Never constructed, so never sent: vendor, notes, receipts, quantities, IDs
 * of any kind, player / facility links, budget line names and notes, income
 * transactions, registration status, fee breakdowns, any dues detail.
 *
 * Accounting is the deployed Finance code, unchanged: buildBudget (with
 * tournaments, ST-011 ownership) for every figure, tournamentRemainder for a
 * tournament's own row, unassignedTournamentCommitments for the separate
 * section. Rows are a breakdown of those figures, proven to sum to them.
 *
 * Coach-only notices travel in `coach`, rendered in the screen toolbar only.
 */

const statusOf = (amount, paid) => {
  if (toCents(paid) >= toCents(amount) && amount > 0) return "Paid";
  if (paid > 0) return "Part paid";
  return "To Pay";
};

/** First and last names of people in the organization, for the coach-only check. */
function nameTokens(people = []) {
  const out = new Set();
  for (const full of people) {
    for (const part of String(full ?? "").split(/\s+/)) {
      const t = part.replace(/[^A-Za-z'-]/g, "").toLowerCase();
      if (t.length >= 3) out.add(t);
    }
  }
  return out;
}
const mentionsSomeone = (text, tokens) =>
  String(text ?? "").toLowerCase().split(/[^a-z'-]+/).some((w) => w.length >= 3 && tokens.has(w));

export function buildBudgetDetail({ budgetItems = [], transactions = [], tournaments = [], people = [] }) {
  const budget = buildBudget(budgetItems, transactions, tournaments);
  const summary = financeSummary(budget, transactions, []);
  const unassignedAll = unassignedTournamentCommitments(tournaments, transactions);
  const tById = new Map(tournaments.map((t) => [t.id, t]));
  const tokens = nameTokens(people);

  const expenses = transactions.filter((t) => !t.is_income);
  const omittedNoAmount = expenses.filter((t) => t.actual_amount == null).length;
  const nameMatches = [];

  const categories = budget.expenses
    .filter((g) => g.budgeted > 0 || g.committedTotal > 0)
    .map((g) => {
      const rows = [];
      let otherAmount = 0, otherPaid = 0, playerAmount = 0, playerPaid = 0;

      for (const line of g.rows) {
        const own = expenses.filter((t) => t.budget_item_id === line.id && isFinanciallyRecorded(t));

        // A protected line: its whole committed and paid figure, nothing else.
        if (line.report_total_only) {
          otherAmount = sumMoney([otherAmount, line.committedTotal]);
          otherPaid = sumMoney([otherPaid, line.actual]);
          continue;
        }

        const linked = tournaments.filter((t) => t.budget_item_id === line.id && t.decision === "Committed");
        const linkedIds = new Set(linked.map((t) => t.id));

        for (const t of linked) {
          const amount = tournamentRemainder(t, transactions, line.id);
          const paid = sumMoney(own.filter((x) => x.tournament_id === t.id && isActual(x)).map((x) => x.actual_amount));
          if (amount <= 0 && paid <= 0) continue;
          rows.push({ kind: "tournament", startDate: t.start_date ?? null, endDate: t.end_date ?? null,
            name: t.name ?? null, amount, status: statusOf(amount, paid), paid });
        }

        for (const x of own.filter((x) => !linkedIds.has(x.tournament_id))) {
          const amount = toCents(x.actual_amount);
          const paid = isActual(x) ? amount : 0;
          if (x.player_id) {
            playerAmount = sumMoney([playerAmount, amount]);
            playerPaid = sumMoney([playerPaid, paid]);
            continue;
          }
          if (mentionsSomeone(x.item, tokens)) nameMatches.push({ date: x.txn_date ?? null, amount });
          rows.push({ kind: "expense", date: x.txn_date ?? null, description: x.item ?? null, amount,
            status: isActual(x) ? "Paid" : "To Pay", paid });
        }
      }

      rows.sort((a, b) => String(a.startDate ?? a.date ?? "").localeCompare(String(b.startDate ?? b.date ?? "")));
      if (playerAmount > 0) rows.push({ kind: "player", label: "Player-specific costs", amount: playerAmount, status: statusOf(playerAmount, playerPaid), paid: playerPaid });
      if (otherAmount > 0) rows.push({ kind: "other", label: "Other category costs", amount: otherAmount, status: statusOf(otherAmount, otherPaid), paid: otherPaid });

      return {
        category: g.category,
        budget: g.budgeted,
        paid: g.paidTotal,
        toPay: g.toPay,
        remaining: g.available,
        committed: g.committedTotal,
        // `paid` on a row is used only to check the arithmetic; the page shows status.
        rows: rows.map(({ paid, ...r }) => r),
        rowPaid: sumMoney(rows.map((r) => r.paid)),
      };
    })
    .sort((a, b) => b.budget - a.budget || a.category.localeCompare(b.category));

  const outstanding = unassignedAll.filter((u) => u.amount > 0);
  const unassignedTotal = sumMoney(outstanding.map((u) => u.amount));

  return {
    season: {
      budget: summary.budgetedExpenses,
      paid: summary.actualExpenses,
      toPay: summary.toPay,
      remaining: summary.availableBudget,
      committed: summary.committedExpenses,
      percentCommitted: summary.percentCommitted,
      unassignedTotal,
      projectedRemaining: sumMoney([summary.availableBudget, -unassignedTotal]),
    },
    categories: categories.map(({ rowPaid, ...c }) => c),
    unassigned: outstanding
      .map((u) => ({ startDate: tById.get(u.id)?.start_date ?? null, endDate: tById.get(u.id)?.end_date ?? null, name: u.name ?? null, amount: u.amount }))
      .sort((a, b) => String(a.startDate ?? "").localeCompare(String(b.startDate ?? ""))),
    coach: {
      omittedNoAmount,
      fullyCoveredUncategorized: unassignedAll.filter((u) => u.amount <= 0).length,
      nameMatches,
    },
    // Internal arithmetic check, stripped before the payload leaves the server.
    _check: { categories: categories.map((c) => ({ committed: c.committed, paid: c.paid, rowSum: sumMoney(c.rows.map((r) => r.amount)), rowPaid: c.rowPaid })) },
  };
}

/** Fetches the season's records and returns the page-safe Detailed payload. */
export async function seasonBudgetDetail(seasonId) {
  if (!seasonId) throw new Error("seasonBudgetDetail requires a seasonId.");
  const supabase = createClient();

  const { data: seasonRow } = await supabase
    .from("seasons")
    .select("id, team:teams ( organization_id )")
    .eq("id", seasonId)
    .maybeSingle();
  const organizationId = seasonRow?.team?.organization_id ?? null;

  const [budgetItems, transactions, tRes, people] = await Promise.all([
    listBudgetItems(seasonId),
    listTransactions(seasonId),
    supabase
      .from("tournaments")
      .select("id, name, start_date, end_date, decision, total_cost, budget_item_id")
      .eq("season_id", seasonId),
    organizationPeople(supabase, organizationId),
  ]);
  if (tRes.error) throw new Error(`Could not load tournaments: ${tRes.error.message}`);

  const { _check, ...detail } = buildBudgetDetail({ budgetItems, transactions, tournaments: tRes.data ?? [], people });
  void _check;
  return detail;
}

/** Names only, used server-side for the coach's check and never returned. */
async function organizationPeople(supabase, organizationId) {
  if (!organizationId) return [];
  const [players, contacts, playerContacts, profiles] = await Promise.all([
    supabase.from("players").select("full_name").eq("organization_id", organizationId),
    supabase.from("contacts").select("full_name").eq("organization_id", organizationId),
    supabase.from("player_contacts").select("full_name").eq("organization_id", organizationId),
    supabase.from("profiles").select("full_name").eq("organization_id", organizationId),
  ]);
  return [players, contacts, playerContacts, profiles].flatMap((r) => (r.data ?? []).map((x) => x.full_name));
}
