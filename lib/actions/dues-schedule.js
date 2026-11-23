"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";

/**
 * Player dues schedules: the writes.
 *
 * Every write is one database function that checks who you are, locks the
 * player, compares the version of the screen you were looking at, and writes
 * or refuses as a whole. Nothing here touches payment_log: applying or
 * changing a schedule never creates, edits or removes a payment.
 */

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to Finance.");
  return ctx;
}
const text = (v) => { const s = (v ?? "").toString().trim(); return s === "" ? null : s; };
const revisionOf = (v) => (v === null || v === "" || !Number.isInteger(Number(v)) ? null : Number(v));
const json = (v) => { try { return JSON.parse(v); } catch { return undefined; } };
const refresh = () => { revalidatePath("/finance"); revalidatePath("/dashboard"); };
const failure = (data, error) => ({
  ok: false,
  code: data?.code,
  players: data?.players,
  error: data?.message || error?.message || "Could not save.",
});

/** The team schedule: exact dates and dollar amounts. */
export async function saveTeamSchedule(formData) {
  try {
    const ctx = await guard();
    const items = json(formData.get("items"));
    if (!Array.isArray(items)) return { ok: false, error: "The schedule is not valid." };
    const { data, error } = await createClient().rpc("save_dues_template", {
      p_season_id: ctx.season.id,
      p_template_id: text(formData.get("template_id")),
      p_expected_revision: revisionOf(formData.get("expected_revision")),
      p_name: text(formData.get("name")) ?? "Standard schedule",
      p_items: items,
      p_is_default: true,
    });
    if (error || !data?.ok) return failure(data, error);
    refresh();
    return { ok: true, id: data.id, revision: data.revision };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Read only: what applying the schedule would do for these players. */
export async function previewTeamSchedule(formData) {
  try {
    await guard();
    const ids = json(formData.get("payment_ids"));
    if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "Choose at least one player." };
    const { data, error } = await createClient().rpc("preview_dues_schedule", {
      p_template_id: text(formData.get("template_id")),
      p_payment_ids: ids,
    });
    if (error || !data?.ok) return failure(data, error);
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Apply the team schedule to the chosen players, all or nothing. */
export async function applyTeamSchedule(formData) {
  try {
    await guard();
    const entries = json(formData.get("entries"));
    if (!Array.isArray(entries) || entries.length === 0) return { ok: false, error: "Choose at least one player." };
    const { data, error } = await createClient().rpc("apply_dues_schedule", {
      p_template_id: text(formData.get("template_id")),
      // One key per review sheet: sending the same request twice cannot apply it twice.
      p_batch_key: text(formData.get("batch_key")) ?? randomUUID(),
      // The team schedule revision the person reviewed. The database refuses the whole
      // request if the dates or amounts changed since.
      p_expected_revision: revisionOf(formData.get("expected_revision")),
      p_entries: entries,
    });
    if (error || !data?.ok) return failure(data, error);
    refresh();
    return { ok: true, applied: data.applied, duplicate: data.duplicate };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * The editor's starting point: the editable values and their version, from ONE database
 * call, so the form can never show one moment's amounts with another moment's version.
 */
export async function loadDuesSnapshot(formData) {
  try {
    await guard();
    const { data, error } = await createClient().rpc("dues_player_snapshot", { p_payment_id: text(formData.get("payment_id")) });
    if (error || !data?.ok) return failure(data, error);
    return { ok: true, snapshot: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** One player: total dues, exempt and schedule, saved together or refused together. */
export async function savePlayerSchedule(formData) {
  try {
    await guard();
    const raw = formData.get("installments");
    const installments = raw === null || raw === "" ? null : json(raw);
    if (installments === undefined) return { ok: false, error: "The schedule is not valid." };
    const total = Number(String(formData.get("total") ?? "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(total)) return { ok: false, error: "Enter the total dues." };
    const { data, error } = await createClient().rpc("save_player_dues", {
      p_payment_id: text(formData.get("payment_id")),
      p_expected_version: text(formData.get("expected_version")),
      p_total: total,
      p_exempt: formData.get("exempt") === "true",
      p_installments: installments,
    });
    if (error || !data?.ok) return failure(data, error);
    refresh();
    return { ok: true, unchanged: data.unchanged };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
