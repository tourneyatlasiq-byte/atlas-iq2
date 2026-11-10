"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getContext, isOrgAdmin } from "../context";
import {
  isInviteExpired,
  inviteExpiryFrom,
  SEND_REFUSALS,
  renderedContextMatches,
  STALE_CONTEXT_MESSAGE,
  NO_CHANGE,
} from "../invite-rules";
import { inviteEmailsEnabled } from "../email/config";
import { sendEmail } from "../email/resend";
import { buildInvitationEmail } from "../email/invitation";

/**
 * Settings and organization administration.
 *
 * Every check here is a courtesy that produces a readable message. The real
 * boundary is RLS: organizations, teams and seasons all require
 * auth_is_org_admin(), so hiding a button is never what stops anyone.
 */

// Beta: parents are not Season Tempo users. The role remains reserved in the
// profiles schema for a future phase, but it cannot be invited — the database
// constraint on invites enforces the same rule.
const INVITE_ROLES = ["coach", "manager"];

function text(v) {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

async function requireAdmin() {
  const ctx = await getContext();
  if (!ctx.profile) throw new Error("You need to be signed in.");
  if (!isOrgAdmin(ctx.profile)) {
    throw new Error("Only an owner or admin can change this.");
  }
  return ctx;
}

function done() {
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function renameOrganization(formData) {
  try {
    const ctx = await requireAdmin();
    const name = text(formData.get("name"));
    if (!name) return { ok: false, error: "Enter an organization name." };

    const supabase = createClient();
    const { error, count } = await supabase
      .from("organizations")
      .update({ name }, { count: "exact" })
      .eq("id", ctx.organization.id);

    if (error) return { ok: false, error: error.message };
    if (count === 0) return { ok: false, error: "Only an owner or admin can rename the organization." };

    return done();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function renameTeam(formData) {
  try {
    const ctx = await requireAdmin();
    const name = text(formData.get("name"));
    if (!name) return { ok: false, error: "Enter a team name." };

    const supabase = createClient();
    const { error, count } = await supabase
      .from("teams")
      .update({ name, is_placeholder_name: false }, { count: "exact" })
      .eq("id", ctx.team.id);

    if (error) return { ok: false, error: error.message };
    if (count === 0) return { ok: false, error: "Only an owner or admin can rename the team." };

    return done();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function renameSeason(formData) {
  try {
    const ctx = await requireAdmin();
    const name = text(formData.get("name"));
    if (!name) return { ok: false, error: "Enter a season name." };

    const supabase = createClient();
    const { error, count } = await supabase
      .from("seasons")
      .update({ name, is_placeholder: false }, { count: "exact" })
      .eq("id", ctx.season.id);

    if (error) return { ok: false, error: error.message };
    if (count === 0) return { ok: false, error: "Only an owner or admin can rename the season." };

    return done();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Phase 2D stale-page guard. Returns a refusal when the form was drawn for a
 * different account or organization than the one signed in now; null when it
 * matches. Runs before any read or write.
 */
function staleRefusal(ctx, formData) {
  const ok = renderedContextMatches(formData, {
    accountId: ctx?.profile?.id,
    organizationId: ctx?.organization?.id,
  });
  return ok ? null : { ok: false, stale: true, error: STALE_CONTEXT_MESSAGE };
}

/**
 * Why an update on one invitation changed nothing, in true words (Phase 2D).
 * The read goes through RLS, so an invitation outside the caller's current
 * organization is simply not visible — that is the "elsewhere" answer.
 */
async function explainNoChange(supabase, ctx, id) {
  const { data } = await supabase
    .from("invites")
    .select("id, accepted_at, revoked_at, organization_id")
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!data) return "elsewhere";
  if (data.accepted_at) return "accepted";
  if (data.revoked_at) return "withdrawn";
  return null;
}

/**
 * Emails one invitation (Phase 2B). The only path that sends.
 *
 *   1. invite_send_begin() checks ownership, refuses manual / accepted /
 *      withdrawn invitations, enforces the rate limits, records the attempt
 *      and returns only what the email needs.
 *   2. The email is built and handed to Resend.
 *   3. invite_send_finish() records "sent" (handed to the provider — not
 *      confirmed inbox delivery) or "failed". A failure never removes the
 *      invitation; its link keeps working.
 *
 * The duplicate-protection key is the invitation plus its count of SUCCESSFUL
 * sends: a retry after a timeout reuses the key, so if the first request did
 * reach Resend it is not sent twice; a deliberate resend after a success gets
 * a new key and is sent again.
 */
async function deliverInvitation(supabase, inviteId) {
  if (!inviteEmailsEnabled()) {
    return { delivery: "refused", message: "Invitation email isn't switched on yet. Use Copy link instead." };
  }

  const { data: row } = await supabase
    .from("invites")
    .select("id, send_count")
    .eq("id", inviteId)
    .maybeSingle();

  const { data: payload, error: beginError } = await supabase.rpc("invite_send_begin", {
    p_invite_id: inviteId,
  });

  if (beginError || !payload?.attempt_id) {
    const msg = (beginError?.message ?? "").trim();
    if (!SEND_REFUSALS.includes(msg)) console.error("invite_send_begin failed:", beginError?.code);
    return {
      delivery: "refused",
      message: SEND_REFUSALS.includes(msg) ? msg : "We couldn't send that invitation. Copy the link instead.",
    };
  }

  let result;
  try {
    const email = buildInvitationEmail(payload);
    result = await sendEmail({
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `invite-${inviteId}-${row?.send_count ?? 0}`,
    });
  } catch {
    result = { ok: false, code: "unknown" };
  }

  const { error: finishError } = await supabase.rpc("invite_send_finish", {
    p_attempt_id: payload.attempt_id,
    p_ok: result.ok,
    p_message_id: result.ok ? result.id : null,
    p_error_code: result.ok ? null : result.code,
  });
  // If recording the outcome fails, the attempt clears itself as stale after
  // two minutes; the owner still gets the true answer about the email.
  if (finishError) console.error("invite_send_finish failed:", finishError.code);

  return result.ok
    ? { delivery: "sent", expiresAt: payload.expires_at }
    : { delivery: "failed", code: result.code, expiresAt: payload.expires_at };
}

/**
 * Creates an invitation and returns the link to share.
 *
 * Role is validated against coach/manager/parent here and CHECK-constrained in
 * the database, so an invitation can never confer owner or admin however it is
 * submitted.
 */
export async function createInvite(formData) {
  try {
    const ctx = await requireAdmin();
    const stale = staleRefusal(ctx, formData);
    if (stale) return stale;

    const email = text(formData.get("email"))?.toLowerCase();
    const role = text(formData.get("role"));
    const teamId = text(formData.get("team_id"));

    if (!email) return { ok: false, error: "Enter an email address." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, error: "That doesn't look like an email address." };
    }
    if (!INVITE_ROLES.includes(role)) {
      return { ok: false, error: "Choose a role of coach or manager." };
    }

    const supabase = createClient();

    // Unused invitations to this address. Normally zero or one; read as a
    // list so an unexpected second row can't turn into an error page.
    const { data: existingRows, error: existingError } = await supabase
      .from("invites")
      .select("id, expires_at, accepted_at, delivery_status")
      .eq("organization_id", ctx.organization.id)
      .ilike("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (existingError) return { ok: false, error: existingError.message };

    let existing = existingRows?.[0] ?? null;

    const emailOn = inviteEmailsEnabled();

    if (existing && !isInviteExpired(existing)) {
      return {
        ok: false,
        error:
          emailOn && existing.delivery_status !== "manual"
            ? "That address already has an invitation waiting. Use Resend or Copy link on it in the list below."
            : "That address already has an invitation waiting. Use Copy link on it in the list below.",
      };
    }

    // With email on, an expired invitation that was only ever shared by link
    // is withdrawn and replaced by a new one that can be emailed. Pre-Phase-2
    // invitations are never emailed themselves, and this happens only because
    // an owner chose to invite that address again.
    if (existing && emailOn && existing.delivery_status === "manual") {
      const { error: revokeError } = await supabase
        .from("invites")
        .update({ revoked_at: new Date().toISOString(), revoked_by: ctx.profile.id })
        .eq("id", existing.id)
        .eq("organization_id", ctx.organization.id)
        .is("accepted_at", null)
        .is("revoked_at", null);
      if (revokeError) return { ok: false, error: revokeError.message };
      existing = null;
    }

    // An expired invitation is renewed in place rather than duplicated: the
    // same row gets the newly chosen role and team and 14 more days, so the
    // history stays in one record and the old link starts working again.
    if (existing) {
      const { data: renewed, error: renewError } = await supabase
        .from("invites")
        .update({
          role,
          team_id: teamId,
          created_by: ctx.profile.id,
          expires_at: inviteExpiryFrom(),
        })
        .eq("id", existing.id)
        .eq("organization_id", ctx.organization.id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .select("id, expires_at")
        .maybeSingle();

      if (renewError) return { ok: false, error: renewError.message };
      if (!renewed) return { ok: false, error: "Only an owner or admin can invite people." };

      if (emailOn) {
        const sent = await deliverInvitation(supabase, renewed.id);
        revalidatePath("/settings");
        return { ok: true, inviteId: renewed.id, expiresAt: sent.expiresAt ?? renewed.expires_at, renewed: true, emailed: true, ...sent };
      }

      revalidatePath("/settings");
      return { ok: true, inviteId: renewed.id, expiresAt: renewed.expires_at, renewed: true };
    }

    const { data, error } = await supabase
      .from("invites")
      .insert({
        organization_id: ctx.organization.id,
        email,
        role,
        team_id: teamId,
        created_by: ctx.profile.id,
        // 'queued' only when email is on; otherwise the database default,
        // 'manual', which can never be emailed later.
        ...(emailOn ? { delivery_status: "queued" } : {}),
      })
      .select("id, expires_at")
      .single();

    // The database allows one live invitation per organization and address
    // (inv_01). Two owners inviting the same person at once land here.
    if (error?.code === "23505") {
      return {
        ok: false,
        error:
          "That address already has an invitation waiting. Use Copy link on it in the list below.",
      };
    }
    if (error) return { ok: false, error: error.message };

    if (emailOn) {
      const sent = await deliverInvitation(supabase, data.id);
      revalidatePath("/settings");
      return { ok: true, inviteId: data.id, expiresAt: sent.expiresAt ?? data.expires_at, emailed: true, ...sent };
    }

    revalidatePath("/settings");
    return { ok: true, inviteId: data.id, expiresAt: data.expires_at, emailed: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Resend (after a successful send) or Retry (after a failure), Phase 2B.
 * Owners only; every rule is re-checked by invite_send_begin(). A manual
 * (link-shared) invitation is refused there, whatever the browser sends.
 */
export async function resendInvite(formData) {
  try {
    const ctx = await requireAdmin();
    const stale = staleRefusal(ctx, formData);
    if (stale) return stale;
    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing record reference." };

    const supabase = createClient();
    const sent = await deliverInvitation(supabase, id);
    revalidatePath("/settings");

    if (sent.delivery === "refused") return { ok: false, error: sent.message };
    return { ok: true, inviteId: id, emailed: true, ...sent };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Gives an expired, unused invitation another 14 days. The link is unchanged.
 * Only an unaccepted invitation in the caller's own organization qualifies;
 * RLS (invites: admin manage) enforces the same.
 */
export async function renewInvite(formData) {
  try {
    const ctx = await requireAdmin();
    const stale = staleRefusal(ctx, formData);
    if (stale) return stale;
    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing record reference." };

    const supabase = createClient();
    const { data, error } = await supabase
      .from("invites")
      .update({ expires_at: inviteExpiryFrom() })
      .eq("id", id)
      .eq("organization_id", ctx.organization.id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .select("id, expires_at")
      .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!data) {
      const why = await explainNoChange(supabase, ctx, id);
      return { ok: false, error: NO_CHANGE[why] ?? NO_CHANGE.elsewhere };
    }

    return { ...done(), inviteId: data.id, expiresAt: data.expires_at };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Withdraws an unused invitation (Phase 2A). A state, not a delete: the row
 * stays as a record, the link stops working at once (accept_invite refuses a
 * withdrawn invitation), and the address can be invited again afterwards.
 */
export async function revokeInvite(formData) {
  try {
    const ctx = await requireAdmin();
    const stale = staleRefusal(ctx, formData);
    if (stale) return stale;
    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing record reference." };

    const supabase = createClient();
    const { data, error } = await supabase
      .from("invites")
      .update({ revoked_at: new Date().toISOString(), revoked_by: ctx.profile.id })
      .eq("id", id)
      .eq("organization_id", ctx.organization.id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!data) {
      const why = await explainNoChange(supabase, ctx, id);
      // Already withdrawn is the outcome the owner asked for: report it as
      // done, so the confirmation closes and the row leaves the list.
      if (why === "withdrawn") return { ...done(), inviteId: id, alreadyWithdrawn: true };
      return { ok: false, error: NO_CHANGE[why] ?? NO_CHANGE.elsewhere };
    }
    return { ...done(), inviteId: id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
