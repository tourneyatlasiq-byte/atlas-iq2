import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/**
 * Resolves the authenticated user's Organization -> Team -> Season context.
 *
 * This is the only place in the application that answers "who is this and
 * which season are they working in". Every page and every action goes
 * through it, which is what keeps scoping consistent — no page derives a
 * team or season on its own.
 *
 * Season is authoritative for team-owned records: a season belongs to
 * exactly one team, so scoping a query by season_id also scopes it by team.
 * We deliberately do not carry a redundant team_id on operational tables.
 *
 * Wrapped in React's cache() so a single render resolves context once
 * regardless of how many components ask for it.
 */
export const getContext = cache(async function getContext() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, organization_id")
    .eq("id", user.id)
    .single();

  // Authenticated but not yet attached to an Organization.
  if (!profile?.organization_id) {
    return { user, profile: profile ?? null, organization: null, teams: [], team: null, seasons: [], season: null };
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, logo_url")
    .eq("id", profile.organization_id)
    .single();

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, is_placeholder_name")
    .eq("organization_id", profile.organization_id)
    .order("name");

  const team = teams?.[0] ?? null;

  let seasons = [];
  let season = null;

  if (team) {
    const { data } = await supabase
      .from("seasons")
      .select("id, name, start_date, end_date, is_current")
      .eq("team_id", team.id)
      .order("start_date", { ascending: false });

    seasons = data ?? [];
    season = seasons.find((s) => s.is_current) ?? seasons[0] ?? null;
  }

  return {
    user,
    profile,
    organization: organization ?? null,
    teams: teams ?? [],
    team,
    seasons,
    season,
  };
});

/** Context plus a guarantee that a season exists. Use in write paths. */
export async function requireSeasonContext() {
  const ctx = await getContext();
  if (!ctx.organization) throw new Error("No organization is linked to this account.");
  if (!ctx.team) throw new Error("This organization has no team yet.");
  if (!ctx.season) throw new Error("This team has no season yet.");
  return ctx;
}

/**
 * Roles permitted to write.
 *
 * MUST stay in sync with the auth_can_write() function in the database.
 * If these two disagree, the UI either hides controls the user is allowed
 * to use, or shows controls whose writes RLS will reject.
 */
const WRITE_ROLES = ["owner", "admin", "coach", "manager"];

export function canWrite(profile) {
  return WRITE_ROLES.includes(profile?.role);
}
