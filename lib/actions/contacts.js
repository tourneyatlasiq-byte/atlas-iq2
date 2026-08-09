"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";

/**
 * Contacts, player links and college interests.
 *
 * Every create returns the new id, because the create-and-link rule depends on
 * it — a record created from inside another record's workflow gets connected
 * automatically, and it cannot be connected without an id.
 */

async function guard(message) {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error(message);
  return ctx;
}

const text = (v) => {
  const s = (v ?? "").toString().trim();
  return s || null;
};

const CATEGORIES = ["Organization", "Tournament", "College", "Other"];

/** Plain wording for the integrity triggers. */
function friendly(error) {
  const m = (error?.message ?? "").toLowerCase();
  if (m.includes("different organization")) {
    return "That record belongs to a different organization.";
  }
  if (m.includes("read-only") || m.includes("finished")) {
    return "That season has finished, so it can't be changed.";
  }
  console.error("contact action failed:", error);
  return "We couldn't save that. Please try again.";
}

export async function saveContact(formData) {
  try {
    const ctx = await guard("Your role doesn't allow changes to contacts.");
    const supabase = createClient();

    const id = text(formData.get("id"));
    const fullName = text(formData.get("full_name"));
    if (!fullName) return { ok: false, error: "Enter the person's name." };

    const category = (formData.get("contact_category") ?? "Other").toString();

    const fields = {
      full_name: fullName,
      contact_category: CATEGORIES.includes(category) ? category : "Other",
      title: text(formData.get("title")),
      organization_or_school: text(formData.get("organization_or_school")),
      email: text(formData.get("email")),
      phone: text(formData.get("phone")),
      notes: text(formData.get("notes")),
    };

    if (id) {
      const { error } = await supabase
        .from("contacts")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return { ok: false, error: friendly(error) };
      revalidatePath("/settings");
      revalidatePath("/tournaments");
      revalidatePath("/team");
      return { ok: true, id };
    }

    const { data: created, error } = await supabase
      .from("contacts")
      .insert({ ...fields, organization_id: ctx.organization.id })
      .select("id")
      .single();

    if (error) return { ok: false, error: friendly(error) };

    revalidatePath("/settings");
    revalidatePath("/tournaments");
    revalidatePath("/team");
    return { ok: true, id: created.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Removes a contact.
 *
 * Tournaments and college interests keep their rows — the foreign keys are
 * ON DELETE SET NULL, so deleting a person never destroys the event or the
 * interest they were attached to.
 */
export async function deleteContact(formData) {
  try {
    await guard("Your role doesn't allow changes to contacts.");
    const supabase = createClient();

    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) return { ok: false, error: friendly(error) };

    revalidatePath("/settings");
    revalidatePath("/tournaments");
    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Links a contact to a tournament, or clears it when contact_id is empty. */
export async function setTournamentContact(formData) {
  try {
    await guard("Your role doesn't allow changes to tournaments.");
    const supabase = createClient();

    const tournamentId = text(formData.get("tournament_id"));
    if (!tournamentId) return { ok: false, error: "Missing tournament reference." };

    const { error } = await supabase
      .from("tournaments")
      .update({ contact_id: text(formData.get("contact_id")) })
      .eq("id", tournamentId);

    if (error) return { ok: false, error: friendly(error) };

    revalidatePath("/tournaments");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------------- Player links ---------------- */

export async function savePlayerLink(formData) {
  try {
    const ctx = await guard("Your role doesn't allow changes to players.");
    const supabase = createClient();

    const playerId = text(formData.get("player_id"));
    const url = text(formData.get("url"));
    const linkType = text(formData.get("link_type")) ?? "Other";

    if (!playerId) return { ok: false, error: "Missing player reference." };
    if (!url) return { ok: false, error: "Enter the link." };

    const { error } = await supabase.from("player_links").insert({
      organization_id: ctx.organization.id,
      player_id: playerId,
      link_type: linkType,
      url: url.startsWith("http") ? url : `https://${url}`,
      label: text(formData.get("label")),
    });

    if (error) return { ok: false, error: friendly(error) };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deletePlayerLink(formData) {
  try {
    await guard("Your role doesn't allow changes to players.");
    const supabase = createClient();

    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase.from("player_links").delete().eq("id", id);
    if (error) return { ok: false, error: friendly(error) };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------------- College interests ---------------- */

export async function saveCollegeInterest(formData) {
  try {
    const ctx = await guard("Your role doesn't allow changes to players.");
    const supabase = createClient();

    const id = text(formData.get("id"));
    const playerId = text(formData.get("player_id"));
    const collegeName = text(formData.get("college_name"));

    if (!playerId) return { ok: false, error: "Missing player reference." };
    if (!collegeName) return { ok: false, error: "Enter the college name." };

    const fields = {
      college_name: collegeName,
      notes: text(formData.get("notes")),
      contact_id: text(formData.get("contact_id")),
    };

    if (id) {
      const { error } = await supabase
        .from("player_college_interests")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return { ok: false, error: friendly(error) };
    } else {
      const { error } = await supabase.from("player_college_interests").insert({
        ...fields,
        organization_id: ctx.organization.id,
        player_id: playerId,
      });
      if (error) return { ok: false, error: friendly(error) };
    }

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deleteCollegeInterest(formData) {
  try {
    await guard("Your role doesn't allow changes to players.");
    const supabase = createClient();

    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase.from("player_college_interests").delete().eq("id", id);
    if (error) return { ok: false, error: friendly(error) };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
