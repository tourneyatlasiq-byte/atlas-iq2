import { cache } from "react";
import { createClient } from "../supabase/server";

/**
 * Bootstrap: who is signed in, and which organization are they acting in.
 *
 * This is the ONE place that reads before an organization is known, so it is
 * deliberately narrow:
 *
 *   - it uses the unpinned client internally and never returns it or exposes
 *     one, so nothing else can build queries on it;
 *   - it reads exactly three things, all of them the caller's own rows:
 *     the auth user, their profile's identity fields and active-organization
 *     pointer, and the membership that pointer names;
 *   - it returns facts, not a client. Everything organization-scoped happens
 *     afterwards on createPinnedClient(membership.organization_id).
 *
 * A wrong pin hides the caller's own profile row (by design, in the
 * database), which is why this read cannot itself be pinned.
 *
 * The pointer is trusted only when a live membership in that organization
 * exists for the same user. A pointer with no matching membership is an
 * inconsistent account and fails closed with an error, not an empty context.
 */
export const resolveActiveMembership = cache(async function resolveActiveMembership() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null, membership: null };

  const { data: row } = await supabase
    .from("profiles")
    .select("id, full_name, onboarding_hidden, active_organization_id")
    .eq("id", user.id)
    .maybeSingle();

  const identity = row
    ? { id: row.id, full_name: row.full_name, onboarding_hidden: row.onboarding_hidden }
    : null;

  // Authenticated but not yet attached to an organization.
  if (!row?.active_organization_id) return { user, profile: identity, membership: null };

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id, authority, legacy_role")
    .eq("user_id", user.id)
    .eq("organization_id", row.active_organization_id)
    .maybeSingle();

  if (!membership) {
    throw new Error("This account's active organization could not be verified. Please contact support.");
  }

  return { user, profile: identity, membership };
});
