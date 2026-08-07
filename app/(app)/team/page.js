import { getContext, canWrite } from "../../../lib/context";
import { listSeasonRoster } from "../../../lib/queries/roster";
import { RosterClient } from "../../../components/RosterClient";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { profile, season } = await getContext();

  if (!season) {
    return (
      <div className="card">
        <div className="empty">
          <h3>No season yet</h3>
          <p>This team needs a season before a roster can be built.</p>
        </div>
      </div>
    );
  }

  const rows = await listSeasonRoster(season.id);

  return <RosterClient rows={rows} canWrite={canWrite(profile)} seasonName={season.name} />;
}
