import { getContext, canWrite } from "../../../lib/context";
import {
  listSeasonTournaments,
  listReferenceData,
  deriveActions,
  deriveSummary,
} from "../../../lib/queries/tournaments";
import { TournamentClient } from "../../../components/TournamentClient";

export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const { profile, season } = await getContext();

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

  const [tournaments, reference] = await Promise.all([
    listSeasonTournaments(season.id),
    listReferenceData(),
  ]);

  return (
    <TournamentClient
      tournaments={tournaments}
      actions={deriveActions(tournaments)}
      summary={deriveSummary(tournaments)}
      providers={reference.providers}
      facilities={reference.facilities}
      canWrite={canWrite(profile)}
    />
  );
}
