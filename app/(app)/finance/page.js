import { getContext, canWrite } from "../../../lib/context";
import {
  listBudgetItems,
  listTransactions,
  listPlayerPayments,
  committedTournamentCost,
  buildBudget,
  financeSummary,
  fundsIn,
  duesSummary,
} from "../../../lib/queries/finance";
import { createClient } from "../../../lib/supabase/server";
import { FinanceClient } from "../../../components/FinanceClient";

export const dynamic = "force-dynamic";

async function pickers(seasonId, organizationId) {
  const supabase = createClient();
  const [tournaments, players, facilities] = await Promise.all([
    supabase.from("tournaments").select("id, name, total_cost").eq("season_id", seasonId).order("start_date"),
    supabase.from("players").select("id, full_name, person_type").eq("organization_id", organizationId).order("full_name"),
    supabase.from("facilities").select("id, name").order("name"),
  ]);
  return {
    tournaments: tournaments.data ?? [],
    players: players.data ?? [],
    facilities: facilities.data ?? [],
  };
}

/**
 * Maps a URL tab name to the internal key. Accepts the readable form used in
 * links ("player-payments") as well as the internal one, so a link can say
 * what it means without the component renaming its own state.
 */
const TAB_ALIASES = {
  budget: "budget",
  "funds-in": "funds",
  funds: "funds",
  transactions: "transactions",
  "player-payments": "payments",
  payments: "payments",
};

export default async function FinancePage({ searchParams }) {
  const { profile, organization, season } = await getContext();

  if (!season) {
    return (
      <div className="card">
        <div className="empty">
          <h3>No season yet</h3>
          <p>This team needs a season before Finance can track a budget.</p>
        </div>
      </div>
    );
  }

  const [budgetItems, transactions, payments, committed, picks] = await Promise.all([
    listBudgetItems(season.id),
    listTransactions(season.id),
    listPlayerPayments(season.id),
    committedTournamentCost(season.id),
    pickers(season.id, organization.id),
  ]);

  const budget = buildBudget(budgetItems, transactions);

  // Awaited so this works whether searchParams is a plain object (Next 14) or
  // a promise (Next 15). Awaiting a non-promise simply returns it.
  const requestedTab = TAB_ALIASES[(await searchParams)?.tab] ?? "budget";

  return (
    <FinanceClient
      budget={budget}
      transactions={transactions}
      payments={payments}
      summary={financeSummary(budget, transactions, payments)}
      funds={fundsIn(transactions, payments, budgetItems)}
      dues={duesSummary(payments)}
      committedTournaments={committed}
      budgetItems={budgetItems}
      tournaments={picks.tournaments}
      players={picks.players}
      facilities={picks.facilities}
      canWrite={canWrite(profile)}
      seasonName={season.name}
      initialTab={requestedTab}
    />
  );
}
