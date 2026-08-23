"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import { BY_KEY, isIgnored } from "../intake/registry";
import { normalizeValue, composeFullName, unreadableValues } from "../intake/normalize";
import { matchPlayer, CLASS } from "../intake/match";
import { buildRowPlan, assertPlanSafe } from "../intake/plan";
import { fingerprintImport } from "../intake/fingerprint";

/**
 * Apply a reviewed player import.
 *
 * THE CLIENT SENDS INPUTS, NEVER WRITES. It supplies normalised field values
 * and the coach's decisions; matching, resolution and planning are re-derived
 * here and assertPlanSafe() is re-run. A tampered payload can at most describe
 * bad data — it has no vocabulary for a destination table.
 *
 * Organization, team and season come from requireSeasonContext(), never from
 * the request, so nobody can import into another organization by editing it.
 *
 * The whole import succeeds or none of it does: intake_apply() is one
 * plpgsql function, and a function body is a single transaction.
 */

/** The same guard every roster action uses. Reused rather than reimplemented. */
async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to the roster.");
  return ctx;
}

const clean = (v) => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length ? v : null;
  const s = String(v).trim();
  return s === "" ? null : v;
};

/**
 * Turn a verified plan into the payload intake_apply() accepts.
 *
 * KEY PRESENCE IS THE CONTRACT. A blank, whitespace-only or absent value
 * produces no key at all, so it cannot reach the database as an erase. The RPC
 * defends the same rule again with coalesce(), because this layer being
 * correct is not a reason to let the next one be careless.
 */
function compact(plan, { row, match, identity }) {
  const isNew = identity === "new" || match.classification === CLASS.NEW;

  const player = {};
  const season = {};

  for (const w of plan.writes) {
    if (w.table === "players") {
      for (const [k, v] of Object.entries(w.values ?? {})) {
        const c = clean(v);
        if (c !== null) player[k] = c;
      }
    } else if (w.table === "team_season_players") {
      for (const [k, v] of Object.entries(w.values ?? {})) {
        const c = clean(v);
        if (c !== null) season[k] = c;
      }
    }
  }

  // full_name is derived HERE and validated by the RPC. A second
  // implementation in PL/pgSQL cannot match String.trim(), which strips all
  // Unicode whitespace — a non-breaking space, form feed or vertical tab each
  // diverge. One implementation, no drift.
  const composed = composeFullName({ ...(plan.existing ?? {}), ...player });
  if (composed) player.full_name = composed;

  const contacts = plan.writes
    .filter((w) => w.table === "player_contacts")
    .map((w) => {
      const c = { op: w.op === "update" ? "update" : "insert" };
      if (c.op === "update") c.contact_id = w.targetId;
      for (const k of ["full_name", "relationship", "email", "phone", "preferred_method"]) {
        const v = clean(w.values?.[k]);
        if (v !== null) c[k] = v;
      }
      // Only a new player's first contact claims primary. An existing
      // player's primary is never changed by an import, and none is promoted
      // when absent — that is the coach's call, not a consequence of row
      // order. The RPC refuses the payload if this is violated.
      if (c.op === "insert" && w.isPrimary) c.is_primary = true;
      if (c.op === "insert") c.sort_order = w.sortOrder ?? 0;
      return c;
    });

  const links = plan.writes
    .filter((w) => w.table === "player_links")
    .map((w) => ({
      link_type: w.linkType,
      url: w.values?.url,
      label: w.values?.label,   // the coach's original string, verbatim
    }));

  const out = { is_new: isNew, player, season, contacts, links };
  if (!isNew) out.player_id = plan.writes.find((w) => w.table === "players")?.targetId ?? null;
  return out;
}

export async function applyIntake({ rows = [], decisions = {}, identity = {}, runKey = null } = {}) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    if (!ctx.team?.id || !ctx.season?.id) {
      return { ok: false, error: "Choose a team and season before importing." };
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "There is nothing to import." };
    }
    if (rows.length > 200) {
      return { ok: false, error: "Import up to 200 players at a time." };
    }

    // The organization's players, read under RLS, for re-matching.
    const { data: existing, error: readErr } = await supabase
      .from("players")
      .select("id, full_name, legal_first_name, preferred_first_name, last_name, "
            + "grad_year, date_of_birth, parent_email, organization_id");
    if (readErr) return { ok: false, error: readErr.message };

    const payload = [];

    for (let i = 0; i < rows.length; i += 1) {
      // Re-normalise through the registry's declared type. Values arriving
      // from the client are treated as raw input, not as trusted output.
      const raw = rows[i] ?? {};
      const row = { contacts: [] };
      for (const [k, v] of Object.entries(raw)) {
        if (k === "contacts") continue;
        const field = BY_KEY.get(k);
        if (!field || !field.importable || isIgnored(k)) continue;
        row[k] = normalizeValue(field.type, v);
      }
      // Re-derived here too, from the SAME helper, so a row the preview
      // blocked cannot slip through server-side and vice versa.
      row._unreadable = unreadableValues(raw, (k) => BY_KEY.get(k));

      row.contacts = (raw.contacts ?? []).map((c) => ({
        full_name: normalizeValue("text", c?.full_name),
        relationship: normalizeValue("text", c?.relationship),
        email: normalizeValue("email", c?.email),
        phone: normalizeValue("phone", c?.phone),
        preferred_method: normalizeValue("enum", c?.preferred_method),
      }));

      // RE-DERIVED. The client's classification is not consulted.
      const match = matchPlayer(row, existing ?? []);
      const chosen = identity[i] ?? null;
      const candidate = chosen === "new" ? null : match.candidate;

      const { data: theirContacts } = candidate
        ? await supabase.from("player_contacts")
            .select("id, full_name, email, phone, is_primary")
            .eq("player_id", candidate.id)
        : { data: [] };

      const plan = buildRowPlan({
        row, match,
        existingPlayer: candidate,
        existingContacts: theirContacts ?? [],
        decisions: decisions[i] ?? {},
        identity: chosen,
      });

      // Re-run server-side. The UI having validated is not a reason to trust
      // what arrived.
      assertPlanSafe(plan);

      if (!plan.executable) {
        return {
          ok: false,
          error: `Row ${i + 1} (${row.full_name ?? "unnamed"}) still needs a decision.`,
          blockers: plan.blockers,
        };
      }

      plan.existing = candidate ?? {};
      payload.push(compact(plan, { row, match, identity: chosen }));
    }

    // The key identifies the SUBMISSION; the fingerprint proves that key is
    // still attached to the content the coach approved. Both are required:
    // without the key a double-click imports twice, and without the fingerprint
    // a changed plan would silently receive the earlier run's result.
    if (!runKey) {
      return { ok: false, error: "This import is missing its submission key. Reopen it and try again." };
    }

    // Computed HERE, over the payload the server derived, using the one
    // canonicalisation implementation. The client never supplies it.
    const fingerprint = fingerprintImport({
      organizationId: ctx.organization.id,
      teamId: ctx.team.id,
      seasonId: ctx.season.id,
      rows: payload,
    });

    const { data, error } = await supabase.rpc("intake_apply_run", {
      p_run_key: runKey,
      p_payload_fingerprint: fingerprint,
      p_team_id: ctx.team.id,        // SERVER context, never the request
      p_season_id: ctx.season.id,
      p_rows: payload,
    });

    if (error) {
      console.error("applyIntake failed:", { runKey, error: error.message });
      return { ok: false, error: error.message };
    }

    revalidatePath("/team");
    revalidatePath("/dashboard");
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
