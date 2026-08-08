import { getContext } from "../../../lib/context";
import { listSeasonRoster, deriveSummary as teamSummary } from "../../../lib/queries/roster";
import {
  listSeasonTournaments,
  deriveSummary as tournamentSummary,
} from "../../../lib/queries/tournaments";
import {
  listBudgetItems,
  listTransactions,
  listPlayerPayments,
  buildBudget,
  financeSummary,
  fundsIn,
  duesSummary,
} from "../../../lib/queries/finance";
import { teamActions } from "../../../lib/readiness/team";
import { dashboardActions, nextUpTournament } from "../../../lib/readiness/dashboard";
import { DashboardClient } from "../../../components/DashboardClient";
import { GettingStarted } from "../../../components/GettingStarted";
import { gettingStartedSteps } from "../../../lib/onboarding";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Dashboard.
 *
 * Read-only. Every figure comes from the same query and rule functions the
 * modules use — nothing is computed a second way here, so a change to a rule
 * cannot leave the Dashboard disagreeing with the module it summarises.
 *
 * Access is inherited entirely from RLS. There is deliberately no Dashboard
 * permission logic: a team-scoped coach sees only their own seasons because
 * every query below already resolves through auth_season_ids().
 */
export default async function DashboardPage() {
  const { profile, organization, team, season, seasonPhase } = await getContext();

  if (!season) {
    return (
      <div className="card">
        <div className="empty">
          <h3>No season yet</h3>
          <p>This team needs a season before the dashboard has anything to summarise.</p>
        </div>
      </div>
    );
  }

  const [roster, tournaments, budgetItems, transactions, payments] = await Promise.all([
    listSeasonRoster(season.id),
    listSeasonTournaments(season.id),
    listBudgetItems(season.id),
    listTransactions(season.id),
    listPlayerPayments(season.id),
  ]);

  const budget = buildBudget(budgetItems, transactions);

  // Getting started steps derive entirely from data that already exists.
  const supabase = createClient();
  const { count: facilityNoteCount } = await supabase
    .from("organization_facilities")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organization.id);

  const steps = gettingStartedSteps({
    teamNamed: Boolean(team) && team.is_placeholder_name !== true,
    seasonNamed: Boolean(season) && season.is_placeholder !== true,
    rosterCount: roster.length,
    tournamentCount: tournaments.length,
    duesCount: payments.length,
    facilityNoteCount: facilityNoteCount ?? 0,
    teamName: team?.name,
    seasonName: season?.name,
  });

  const team_ = teamSummary(roster);

  return (
    <>
      {!profile?.onboarding_hidden && <GettingStarted steps={steps} />}
      <DashboardClient
      context={{
        organization: organization.name,
        team: team?.name ?? "No team",
        season: season.name,
      }}
      nextUp={nextUpTournament(tournaments)}
      // Needs Action answers "what needs doing now". A past season has nothing
      // outstanding, and a planning season has not started.
      actions={
        seasonPhase === "current"
          ? dashboardActions({ roster, tournaments, payments })
          : { visible: [], total: 0, hidden: 0, overflowModules: [] }
      }
      seasonPhase={seasonPhase}
      finance={financeSummary(budget, transactions, payments)}
      funds={fundsIn(transactions, payments, budgetItems)}
      dues={duesSummary(payments)}
      team={{ ...team_, actionCount: teamActions(roster).length }}
      seasonSummary={tournamentSummary(tournaments)}
      />
    </>
  );
}
