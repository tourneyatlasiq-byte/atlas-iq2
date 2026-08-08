import { getContext, canWrite } from "../../../lib/context";
import {
  listSeasonTournaments,
  listReferenceData,
  deriveSummary,
  seasonRecord,
} from "../../../lib/queries/tournaments";
import { tournamentActions } from "../../../lib/readiness/tournaments";
import { documentsByEntity, documentTargets } from "../../../lib/queries/documents";
import { TournamentClient } from "../../../components/TournamentClient";

export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const { profile, organization, season } = await getContext();

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

  const withDocs = tournaments.map((t) => ({
    ...t,
    documents: docsByTournament.get(t.id) ?? [],
  }));

  return (
    <TournamentClient
      tournaments={withDocs}
      actions={tournamentActions(withDocs)}
      summary={deriveSummary(withDocs)}
      record={seasonRecord(withDocs)}
      providers={reference.providers}
      facilities={reference.facilities}
      canWrite={canWrite(profile)}
      isAdmin={profile?.role === "owner" || profile?.role === "admin"}
      documentTargets={docTargets}
      seasonName={season.name}
    />
  );
}
