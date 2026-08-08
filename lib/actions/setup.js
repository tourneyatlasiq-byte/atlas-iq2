"use server";

import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";

/**
 * First-run setup for a brand-new organization.
 *
 * The client sends three strings and nothing else. Organization id, role and
 * profile id are all decided server-side inside create_organization_setup(),
 * which is where the Phase 1 vulnerability was closed — accepting any of them
 * from the browser is what allowed a stranger to join an existing organization
 * as owner.
 */

const GENERIC = "We couldn't create your team just now. Please try again.";

/**
 * Turns a database error into something a coach can act on.
 *
 * Matched on SQLSTATE rather than message text, so a wording change in the
 * function can't silently fall through to the generic branch. Raw Postgres
 * text is never returned — it leaks function signatures and constraint names.
 */
function friendlyError(error) {
  if (!error) return GENERIC;

  switch (error.code) {
    case "23505": // unique_violation — this account already has a profile
      return "already-set-up";
    case "42501": // insufficient_privilege — no valid session
      return "Your sign-in expired. Please sign in again.";
    default:
      break;
  }

  // The function's own validation messages are written for this audience.
  const msg = error.message ?? "";
  if (/^Enter (an organization name|a team name|a season)\.$/.test(msg.trim())) {
    return msg.trim();
  }

  console.error("create_organization_setup failed:", error);
  return GENERIC;
}

export async function createOrganization(formData) {
  const organizationName = (formData.get("organization_name") ?? "").toString().trim();
  const teamName = (formData.get("team_name") ?? "").toString().trim();
  const seasonName = (formData.get("season_name") ?? "").toString().trim();

  if (!organizationName) return { ok: false, error: "Enter your club or organization name." };
  if (!teamName) return { ok: false, error: "Enter your team name." };
  if (!seasonName) return { ok: false, error: "Enter a season." };

  const supabase = createClient();

  const { error } = await supabase.rpc("create_organization_setup", {
    p_organization_name: organizationName,
    p_team_name: teamName,
    p_season_name: seasonName,
  });

  if (error) {
    const friendly = friendlyError(error);

    // Already set up isn't really a failure — the user has a home to go to.
    if (friendly === "already-set-up") redirect("/dashboard");

    return { ok: false, error: friendly };
  }

  redirect("/dashboard");
}
