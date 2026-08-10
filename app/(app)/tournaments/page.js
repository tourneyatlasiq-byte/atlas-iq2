import { getContext, canWrite } from "../../../lib/context";
import {
  listSeasonTournaments,
  listReferenceData,
  deriveSummary,
  seasonRecord,
} from "../../../lib/queries/tournaments";
import { tournamentActions } from "../../../lib/readiness/tournaments";
import { documentsByEntity, documentTargets } from "../../../lib/queries/documents";
import { participantsBySeason, pickupCandidates } from "../../../lib/queries/participants";
import { listSeasonRoster } from "../../../lib/queries/roster";
import { listContacts } from "../../../lib/queries/contacts";
import { listBudgetItems, listTransactions } from "../../../lib/queries/finance";
import { budgetLineFinance } from "../../../lib/finance-rules";
import { TournamentClient } from "../../../components/TournamentClient";

import { createClient } from "../../../lib/supabase/server";
import { SetupNext, setupState } from "../../../components/SetupNext";

export const dynamic = "force-dynamic";

export default async function TournamentsPage({ searchParams }) {
  const { profile, organization, team, season, seasonPhase } = await getContext();

  if (!season) {
    return (
      <div className="card">
        <div className="empty">
          <h3>No season yet</h3>
          <p>This team needs a season before tournaments can be planned.</p>
        </div>
      </div>
    );
  }

  const [tournaments, reference, docsByTournament, docTargets] = await Promise.all([
    listSeasonTournaments(season.id),
    listReferenceData(),
    documentsByEntity("tournament_id"),
    documentTargets(season.id, organization.id),
  ]);

  // Budget context for the drawer: each expense line with its committed and
  // available figures, computed by the same rule Finance uses.
  const [budgetItems, budgetTxns] = await Promise.all([
    listBudgetItems(season.id),
    listTransactions(season.id),
  ]);

  const budgetLines = budgetItems
    .filter((b) => !b.is_income)
    .map((b) => {
      const fin = budgetLineFinance(b, budgetTxns, tournaments);
      return {
        id: b.id,
        name: b.name,
        category: b.category,
        planned: fin.planned,
        committed: fin.committed,
        paid: fin.paid,
        available: fin.available,
        percentCommitted: fin.percentCommitted,
      };
    });

  const [participantMap, seasonRoster, candidates, playerDocs] = await Promise.all([
    participantsBySeason(season.id),
    listSeasonRoster(season.id),
    pickupCandidates(organization.id, season.id),
    documentsByEntity("player_id"),
  ]);

  const withDocs = tournaments.map((t) => ({
    ...t,
    documents: docsByTournament.get(t.id) ?? [],
  }));

  const setup = await setupState(createClient(), { organization, team, season, profile });

  return (
    <>
      <SetupNext steps={setup.steps} hidden={setup.hidden} currentStepId="tournament" />
    <TournamentClient
      tournaments={withDocs}
      actions={seasonPhase === "current" ? tournamentActions(withDocs) : []}
      summary={deriveSummary(withDocs)}
      record={seasonRecord(withDocs)}
      providers={reference.providers}
      facilities={reference.facilities}
      canWrite={canWrite(profile)}
      isAdmin={profile?.role === "owner" || profile?.role === "admin"}
      documentTargets={docTargets}
      seasonName={season.name}
      participants={Object.fromEntries(participantMap)}
      seasonRoster={seasonRoster}
      pickupCandidates={candidates}
      playerDocuments={playerDocs}
      contacts={await listContacts(organization.id)}
      budgetLines={budgetLines}
      autoOpen={(await searchParams)?.add === "1"}
    />
    </>
  );
}
