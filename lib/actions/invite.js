"use server";

import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";

/**
 * Accepts an invitation.
 *
 * The client sends only the invitation id. Organization and role come from the
 * invitation itself, and accept_invite() matches on the signed-in email — so
 * possessing a link is not enough.
 */
export async function acceptInvitation(inviteId) {
  if (!inviteId) return { ok: false, error: "That invitation link isn't valid." };

  const supabase = createClient();
  const { error } = await supabase.rpc("accept_invite", { p_invite_id: inviteId });

  if (error) {
    // The function's messages are written for this audience; anything else is
    // masked so database detail never reaches the page.
    const known = [
      "That invitation is not valid for this account.",
      "That invitation has already been used.",
      "That invitation has expired. Ask for a new one.",
      "This account already belongs to an organization.",
      "You must be signed in to accept an invitation.",
    ];
    const msg = (error.message ?? "").trim();
    if (known.includes(msg)) return { ok: false, error: msg };

    console.error("accept_invite failed:", error);
    return { ok: false, error: "We couldn't accept that invitation. Ask for a new one." };
  }

  redirect("/dashboard");
}
