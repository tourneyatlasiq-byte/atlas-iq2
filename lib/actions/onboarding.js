"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getContext } from "../context";

/**
 * The one write behind hiding and restoring the Getting started card.
 *
 * Per user, not per organization: one coach hiding it should not hide it for a
 * manager who has not seen it yet. The profiles update policy pins role and
 * organization_id, so this can only ever change the caller's own preference.
 */
async function setHidden(hidden) {
  try {
    const ctx = await getContext();
    if (!ctx.profile) return { ok: false, error: "No profile for this account." };

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_hidden: hidden })
      .eq("id", ctx.profile.id);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/dashboard");
    // Hiding refreshes Help so it can offer the restore button. Restoring does
    // not: it would remove the button (and its confirmation) from under the
    // person; the next visit to Help reads the new state.
    if (hidden) revalidatePath("/help");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Dismisses the Getting started card for the current user. */
export async function hideGettingStarted() {
  return setHidden(true);
}

/** Brings the card back on Home (from Help). The mirror of hideGettingStarted. */
export async function showGettingStarted() {
  return setHidden(false);
}
