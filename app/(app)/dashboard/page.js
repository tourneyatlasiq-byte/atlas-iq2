import { getContext } from "../../../lib/context";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

async function countsFor(seasonId) {
  const supabase = createClient();
  const head = { count: "exact", head: true };

  const [roster, tournaments, games] = await Promise.all([
    supabase.from("team_season_players").select("id", head).eq("season_id", seasonId),
    supabase.from("tournaments").select("id", head).eq("season_id", seasonId),
    supabase.from("games").select("id", head).eq("season_id", seasonId),
  ]);

  return {
    roster: roster.count ?? 0,
    tournaments: tournaments.count ?? 0,
    games: games.count ?? 0,
  };
}

export default async function DashboardPage() {
  const { organization, team, season } = await getContext();

  const counts = season ? await countsFor(season.id) : { roster: 0, tournaments: 0, games: 0 };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="page-sub">
            {organization.name} · {team?.name ?? "No team"} · {season?.name ?? "No season"}
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="card">
          <div className="stat-label">Roster</div>
          <div className="stat-value">{counts.roster}</div>
        </div>
        <div className="card">
          <div className="stat-label">Tournaments</div>
          <div className="stat-value">{counts.tournaments}</div>
        </div>
        <div className="card">
          <div className="stat-label">Games</div>
          <div className="stat-value">{counts.games}</div>
        </div>
      </div>

      <div className="card">
        <h2>Stabilization in progress</h2>
        <p className="page-sub" style={{ marginTop: 8 }}>
          Team is live and running on the current schema. Tournament IQ, Facilities, Finance and
          Files are next, in that order. This dashboard will grow into a real summary once those
          modules are working.
        </p>
      </div>
    </>
  );
}
