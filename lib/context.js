import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export const VIEW_SEASON_COOKIE = "atlas_view_season";

/**
 * Who is looking, without forcing a sign-in.
 *
 * getContext() redirects to /login when there is no session, which is right
 * for the application but wrong for the public homepage — that page has to
 * render for strangers.
 */
export async function getViewer() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, hasOrganization: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .maybeSingle();

  return { user, hasOrganization: Boolean(profile?.organization_id) };
}

/** Ordering key. Real dates when we have them, creation order when we don't. */
const seasonKey = (s) => s?.start_date ?? s?.created_at?.slice(0, 10) ?? "";

/**
 * Which of three states a season is in.
 *
 *   current  the team is working in it now
 *   future   created for planning, not yet started — editable
 *   past     finished — read-only
 *
 * "Not current" does not mean historical. A coach building next year's roster
 * in March needs to write to a season that is not current yet.
 */
export function seasonPhase(season, currentSeason) {
  if (!season) return "current";
  if (season.is_current) return "current";
  if (!currentSeason) return "current";
  return seasonKey(season) > seasonKey(currentSeason) ? "future" : "past";
}

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
/**
 * Resolves a season id from a URL against the seasons this user can reach.
 *
 * Validated by membership of the RLS-bounded list, so a shared or stale link
 * falls back to the normal view rather than erroring or hinting that a record
 * exists. Viewing only — is_current is never touched.
 *
 * Event Roster and player history can reuse this unchanged.
 */
export async function resolveViewSeason(seasonId) {
  if (!seasonId) return null;
  const ctx = await getContext();
  return ctx.seasons.find((s) => s.id === seasonId)?.id ?? null;
}

export const getContext = cache(async function getContext() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, organization_id, onboarding_hidden")
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

  // RLS already filters this to teams the user can access, so the list is
  // itself the authorization boundary.
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, name, is_placeholder_name")
    .eq("organization_id", profile.organization_id)
    .order("name");

  const teams = teamRows ?? [];

  const { data: seasonRows } = teams.length
    ? await supabase
        .from("seasons")
        .select("id, name, team_id, start_date, end_date, is_current, is_placeholder, created_at")
        .in("team_id", teams.map((t) => t.id))
        .order("start_date", { ascending: false, nullsFirst: false })
    : { data: [] };

  const seasons = seasonRows ?? [];

  // The viewing preference. Validated by membership of the list above rather
  // than by parsing — a tampered value simply will not match, and RLS has
  // already bounded the list to this user's own teams.
  const viewCookie = cookies().get(VIEW_SEASON_COOKIE)?.value ?? null;
  const viewed = viewCookie ? seasons.find((s) => s.id === viewCookie) : null;

  const currentSeason = seasons.find((s) => s.is_current) ?? null;
  const season = viewed ?? currentSeason ?? seasons[0] ?? null;

  // Team follows the season, never the other way round. Picking teams[0] meant
  // an organization with two teams silently only ever saw the first.
  const team =
    (season && teams.find((t) => t.id === season.team_id)) ?? teams[0] ?? null;

  return {
    user,
    profile,
    organization: organization ?? null,
    teams,
    team,
    seasons: seasons.filter((s) => !team || s.team_id === team.id),
    season,
    seasonPhase: seasonPhase(season, currentSeason),
    currentSeason,
  };
});

/** Context plus a guarantee that a season exists. Use in write paths. */
export async function requireSeasonContext() {
  const ctx = await getContext();
  if (!ctx.organization) throw new Error("No organization is linked to this account.");
  if (!ctx.team) throw new Error("This organization has no team yet.");
  if (!ctx.season) throw new Error("This team has no season yet.");

  // Past seasons are history. A stale tab must not be able to write into one.
  // Future seasons are deliberately writable — planning ahead is the point.
  if (ctx.seasonPhase === "past") {
    throw new Error(
      "You're viewing a past season, which is read-only. Return to the current season to make changes."
    );
  }

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

/**
 * Mirrors auth_is_org_admin() in the database.
 *
 * Structure — organization, team, season, invitations, shared facility
 * curation — is admin-only. Operational data is canWrite(). Keep both in step
 * with their database counterparts; they have drifted before.
 */
export function isOrgAdmin(profile) {
  return profile?.role === "owner" || profile?.role === "admin";
}

export function canWrite(profile) {
  return WRITE_ROLES.includes(profile?.role);
}
