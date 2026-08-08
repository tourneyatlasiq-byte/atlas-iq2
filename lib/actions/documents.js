"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import {
  CATEGORIES,
  isRestricted,
  ALLOWED_MIME,
  MAX_FILE_BYTES,
  DOCUMENTS_BUCKET,
  buildFilePath,
  sanitizeFilename,
} from "../documents";

/**
 * Document writes.
 *
 * The upload sequence is deliberate:
 *   1. server generates the document id and canonical path
 *   2. server inserts the metadata row
 *   3. client uploads to that exact path
 *   4. on upload failure the client calls discardDocumentRecord
 *
 * Metadata first, because the storage read policy resolves a category from
 * documents.file_path. An object with no metadata row is treated as sensitive
 * and is admin-only, so an orphan can never be silently world-readable within
 * the organization.
 *
 * The bucket and path are computed server-side and never accepted from the
 * client — otherwise a caller could target the public team-logos bucket or
 * write outside their organization's folder.
 */

function text(v) {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow managing files.");
  return ctx;
}

const isAdmin = (profile) => profile?.role === "owner" || profile?.role === "admin";

/**
 * Creates the metadata row and returns where the client should upload.
 * RLS independently rejects a restricted category from a non-admin; the check
 * here exists to return a clear message rather than a policy error.
 */
export async function createDocumentRecord(input) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const category = text(input?.category);
    const fileName = text(input?.fileName);
    const fileSize = Number(input?.fileSize ?? 0);
    const mimeType = text(input?.mimeType);

    if (!fileName) return { ok: false, error: "Missing file name." };
    if (!CATEGORIES.includes(category)) return { ok: false, error: "Pick a category." };
    if (isRestricted(category) && !isAdmin(ctx.profile)) {
      return { ok: false, error: "Only an owner or admin can upload a Birth Certificate." };
    }
    if (!ALLOWED_MIME.includes(mimeType)) {
      return { ok: false, error: "Only PDF, JPG and PNG files are accepted." };
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_BYTES) {
      return { ok: false, error: "Files must be between 1 byte and 10 MB." };
    }

    const documentId = crypto.randomUUID();
    const seasonId = input?.scope === "organization" ? null : ctx.season.id;

    const filePath = buildFilePath({
      organizationId: ctx.organization.id,
      seasonId,
      documentId,
      fileName,
    });

    const { error } = await supabase.from("documents").insert({
      id: documentId,
      organization_id: ctx.organization.id,
      season_id: seasonId,
      category,
      file_name: sanitizeFilename(fileName),
      file_path: filePath,
      mime_type: mimeType,
      file_size: Math.round(fileSize),
      uploaded_by: ctx.profile.id,
      notes: text(input?.notes),
      player_id: text(input?.playerId),
      tournament_id: text(input?.tournamentId),
      facility_id: text(input?.facilityId),
    });

    if (error) return { ok: false, error: error.message };

    return { ok: true, documentId, filePath, bucket: DOCUMENTS_BUCKET };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Removes a metadata row whose upload failed, so no orphan row remains. */
export async function discardDocumentRecord(documentId) {
  try {
    await guard();
    const supabase = createClient();
    if (!documentId) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase.from("documents").delete().eq("id", documentId);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/files");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Confirms an upload landed. Separate call so the list only refreshes once. */
export async function confirmDocumentUpload() {
  revalidatePath("/files");
  return { ok: true };
}

/**
 * Short-lived signed URL.
 *
 * 60 seconds, generated on click. Signing requires SELECT on the storage
 * object, so the category gate applies here exactly as it does elsewhere —
 * a coach cannot obtain a URL for a Birth Certificate.
 *
 * A signed URL stays valid until it expires regardless of later permission
 * changes, which is why the window is deliberately small.
 */
export async function getDocumentUrl(documentId) {
  try {
    await requireSeasonContext();
    const supabase = createClient();

    const { data: doc, error: readError } = await supabase
      .from("documents")
      .select("id, file_path, file_name")
      .eq("id", documentId)
      .single();

    if (readError || !doc) {
      return { ok: false, error: "That file isn't available to you." };
    }

    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(doc.file_path, 60, { download: doc.file_name });

    if (error) return { ok: false, error: "That file isn't available to you." };

    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Metadata edits. Recategorizing into or out of a restricted category is admin-only. */
export async function updateDocument(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const category = text(formData.get("category"));
    if (!CATEGORIES.includes(category)) return { ok: false, error: "Pick a category." };
    if (isRestricted(category) && !isAdmin(ctx.profile)) {
      return { ok: false, error: "Only an owner or admin can use the Birth Certificate category." };
    }

    const { error } = await supabase
      .from("documents")
      .update({
        category,
        file_name: sanitizeFilename(text(formData.get("file_name")) ?? "file"),
        notes: text(formData.get("notes")),
        player_id: text(formData.get("player_id")),
        tournament_id: text(formData.get("tournament_id")),
        facility_id: text(formData.get("facility_id")),
      })
      .eq("id", id);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/files");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Deletes the stored object and then its metadata row. */
export async function deleteDocument(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const { data: doc } = await supabase
      .from("documents")
      .select("id, file_path")
      .eq("id", id)
      .single();

    if (!doc) return { ok: false, error: "That file isn't available to you." };

    // Storage first: a failed object delete leaves the row so the file is still
    // reachable and can be retried, rather than orphaning it invisibly.
    const { error: storageError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([doc.file_path]);

    if (storageError) {
      return { ok: false, error: `Could not remove the stored file: ${storageError.message}` };
    }

    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/files");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
