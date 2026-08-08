"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getContext } from "../context";

/**
 * Dismisses the Getting started card for the current user.
 *
 * Per user, not per organization — one coach hiding it should not hide it for
 * a manager who has not seen it yet.
 *
 * The profiles update policy pins role and organization_id, so this can only
 * ever change the caller's own preference.
 */
export async function hideGettingStarted() {
  try {
    const ctx = await getContext();
    if (!ctx.profile) return { ok: false, error: "No profile for this account." };

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_hidden: true })
      .eq("id", ctx.profile.id);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
