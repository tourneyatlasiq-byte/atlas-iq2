"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext } from "../context";

/**
 * Organization branding.
 *
 * Reuses organizations.logo_url and the existing team-logos bucket — both were
 * provisioned long ago and never surfaced. No new schema or storage.
 *
 * Owner-only, enforced twice: here for a readable message, and by the storage
 * policy so the rule holds however the request arrives.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };

async function ownerOnly() {
  const ctx = await requireSeasonContext();
  if (ctx.profile?.role !== "owner") {
    throw new Error("Only an owner can change the team logo.");
  }
  return ctx;
}

export async function uploadTeamLogo(formData) {
  try {
    const ctx = await ownerOnly();
    const supabase = createClient();

    const file = formData.get("logo");
    if (!file || typeof file === "string" || file.size === 0) {
      return { ok: false, error: "Choose an image to upload." };
    }

    const ext = TYPES[file.type];
    if (!ext) {
      return { ok: false, error: "Use a PNG, JPG, WEBP or SVG image." };
    }

    if (file.size > MAX_BYTES) {
      return { ok: false, error: "That image is larger than 2 MB. Try a smaller one." };
    }

    // One logo per organization. A fixed name means replacing overwrites
    // rather than accumulating orphaned files nobody can see or clean up.
    const path = `${ctx.organization.id}/logo.${ext}`;

    // A previous logo in a different format would otherwise linger.
    const { data: existing } = await supabase.storage
      .from("team-logos")
      .list(ctx.organization.id);

    const stale = (existing ?? [])
      .filter((f) => f.name.startsWith("logo.") && f.name !== `logo.${ext}`)
      .map((f) => `${ctx.organization.id}/${f.name}`);

    if (stale.length) await supabase.storage.from("team-logos").remove(stale);

    const { error: uploadError } = await supabase.storage
      .from("team-logos")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      if ((uploadError.message ?? "").toLowerCase().includes("row-level security")) {
        return { ok: false, error: "Only an owner can change the team logo." };
      }
      return { ok: false, error: uploadError.message };
    }

    const { data: pub } = supabase.storage.from("team-logos").getPublicUrl(path);

    // Cache-busted, or a replaced logo keeps showing the old image.
    const url = `${pub.publicUrl}?v=${Date.now()}`;

    const { error } = await supabase
      .from("organizations")
      .update({ logo_url: url })
      .eq("id", ctx.organization.id);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/", "layout");
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function removeTeamLogo() {
  try {
    const ctx = await ownerOnly();
    const supabase = createClient();

    const { data: files } = await supabase.storage
      .from("team-logos")
      .list(ctx.organization.id);

    const paths = (files ?? []).map((f) => `${ctx.organization.id}/${f.name}`);
    if (paths.length) await supabase.storage.from("team-logos").remove(paths);

    const { error } = await supabase
      .from("organizations")
      .update({ logo_url: null })
      .eq("id", ctx.organization.id);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
