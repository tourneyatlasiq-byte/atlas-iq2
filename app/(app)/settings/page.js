import { getContext, isOrgAdmin } from "../../../lib/context";
import { createClient } from "../../../lib/supabase/server";
import { SettingsClient } from "../../../components/SettingsClient";

export const dynamic = "force-dynamic";

/**
 * Settings — organization administration.
 *
 * Readable by everyone in the organization; edit controls appear only for
 * owners and admins. RLS enforces that independently, so the hidden buttons
 * are a courtesy rather than the boundary.
 */
export default async function SettingsPage() {
  const { user, profile, organization, team, season } = await getContext();
  const supabase = createClient();

  const [profilesRes, invitesRes, teamsRes, memberships, rosterCount, tournamentCount] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("organization_id", organization.id)
        .order("role"),
      supabase
        .from("invites")
        .select("id, email, role, created_at, accepted_at, expires_at, team_id, team:teams(id, name)")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("teams")
        .select("id, name")
        .eq("organization_id", organization.id)
        .order("name"),
      supabase.from("team_memberships").select("profile_id, team:teams(id, name)"),
      season
        ? supabase
            .from("team_season_players")
            .select("id", { count: "exact", head: true })
            .eq("season_id", season.id)
        : Promise.resolve({ count: 0 }),
      season
        ? supabase
            .from("tournaments")
            .select("id", { count: "exact", head: true })
            .eq("season_id", season.id)
        : Promise.resolve({ count: 0 }),
    ]);

  // An owner or admin sees every team, so listing their memberships would be
  // misleading — "All teams" is the honest description.
  const teamsBy = new Map();
  for (const m of memberships.data ?? []) {
    teamsBy.set(m.profile_id, [...(teamsBy.get(m.profile_id) ?? []), m.team?.name].filter(Boolean));
  }

  const people = (profilesRes.data ?? []).map((p) => ({
    ...p,
    teamNames: isOrgAdmin(p) ? [] : teamsBy.get(p.id) ?? [],
  }));

  return (
    <SettingsClient
      organization={organization}
      team={team}
      season={season}
      people={people}
      invites={invitesRes.data ?? []}
      teams={teamsRes.data ?? []}
      counts={{ roster: rosterCount.count ?? 0, tournaments: tournamentCount.count ?? 0 }}
      isAdmin={isOrgAdmin(profile)}
      currentUserId={user.id}
    />
  );
}
