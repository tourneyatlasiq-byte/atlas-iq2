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

export default async function FinancePage() {
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

  const [items, transactions, payments, committed, picks] = await Promise.all([
    listBudgetItems(season.id),
    listTransactions(season.id),
    listPlayerPayments(season.id),
    committedTournamentCost(season.id),
    pickers(season.id, organization.id),
  ]);

  const budget = buildBudget(items, transactions);

  return (
    <FinanceClient
      budget={budget}
      transactions={transactions}
      payments={payments}
      summary={financeSummary(budget, transactions, payments)}
      funds={fundsIn(transactions, payments)}
      dues={duesSummary(payments)}
      committedTournaments={committed}
      budgetItems={items}
      tournaments={picks.tournaments}
      players={picks.players}
      facilities={picks.facilities}
      canWrite={canWrite(profile)}
      seasonName={season.name}
    />
  );
}
