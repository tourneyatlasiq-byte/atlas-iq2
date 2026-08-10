"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getContext, isOrgAdmin } from "../context";

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
 * Creates an invitation and returns the link to share.
 *
 * Role is validated against coach/manager/parent here and CHECK-constrained in
 * the database, so an invitation can never confer owner or admin however it is
 * submitted.
 */
export async function createInvite(formData) {
  try {
    const ctx = await requireAdmin();

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

    const { data: existing } = await supabase
      .from("invites")
      .select("id")
      .eq("organization_id", ctx.organization.id)
      .ilike("email", email)
      .is("accepted_at", null)
      .maybeSingle();

    if (existing) {
      return { ok: false, error: "There's already an unused invitation for that email address." };
    }

    const { data, error } = await supabase
      .from("invites")
      .insert({
        organization_id: ctx.organization.id,
        email,
        role,
        team_id: teamId,
        created_by: ctx.profile.id,
      })
      .select("id, expires_at")
      .single();

    if (error) return { ok: false, error: error.message };

    revalidatePath("/settings");
    return { ok: true, inviteId: data.id, expiresAt: data.expires_at };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Withdraws an invitation that hasn't been used. */
export async function cancelInvite(formData) {
  try {
    await requireAdmin();
    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing record reference." };

    const supabase = createClient();
    const { error } = await supabase
      .from("invites")
      .delete()
      .eq("id", id)
      .is("accepted_at", null);

    if (error) return { ok: false, error: error.message };
    return done();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
