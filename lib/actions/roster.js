"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";

/**
 * Roster writes.
 *
 * Two entities are involved and the split matters:
 *   players               persistent identity, survives across seasons
 *   team_season_players   this season's assignment (jersey, sizes, positions, status)
 *
 * Removing someone from a roster deletes the ASSIGNMENT only. The player
 * record stays, so their history in other seasons is preserved.
 */

function text(v) {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function int(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function list(formData, key) {
  const all = formData.getAll(key).map((v) => v.toString().trim()).filter(Boolean);
  return all.length ? all : null;
}

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to the roster.");
  return ctx;
}

function playerFields(formData) {
  return {
    full_name: text(formData.get("full_name")),
    person_type: text(formData.get("person_type")) ?? "player",
    // A named staff role arrives as a hidden other_role_label; "Other" sends
    // custom_role instead. Players carry no role label at all.
    other_role_label:
      text(formData.get("person_type")) === "player"
        ? null
        : text(formData.get("custom_role")) ?? text(formData.get("other_role_label")),
    grad_year: int(formData.get("grad_year")),
    date_of_birth: text(formData.get("date_of_birth")),
    throws: text(formData.get("throws")),
    bats: text(formData.get("bats")),
    player_email: text(formData.get("player_email")),
    player_phone: text(formData.get("player_phone")),
    parent_name: text(formData.get("parent_name")),
    parent_email: text(formData.get("parent_email")),
    parent_phone: text(formData.get("parent_phone")),
    notes: text(formData.get("notes")),
  };
}

function assignmentFields(formData) {
  const positions = list(formData, "positions");
  return {
    jersey_number: int(formData.get("jersey_number")),
    jersey_size: text(formData.get("jersey_size")),
    pants_size: text(formData.get("pants_size")),
    positions,
    // Legacy singular column kept in step for compatibility.
    position: positions?.[0] ?? null,
    is_active: formData.get("is_active") !== "false",
  };
}

/** Creates a new persistent player and assigns them to the current season. */
export async function addRosterMember(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const player = playerFields(formData);
    if (!player.full_name) return { ok: false, error: "Enter a name." };

    const { data: created, error: playerError } = await supabase
      .from("players")
      .insert({ ...player, organization_id: ctx.organization.id })
      .select("id")
      .single();

    if (playerError) return { ok: false, error: playerError.message };

    const { error: assignError } = await supabase.from("team_season_players").insert({
      ...assignmentFields(formData),
      player_id: created.id,
      team_id: ctx.team.id,
      season_id: ctx.season.id,
    });

    if (assignError) {
      // Don't leave an orphaned identity behind if the assignment fails.
      await supabase.from("players").delete().eq("id", created.id);
      return { ok: false, error: assignError.message };
    }

    // Dues are optional and must never block adding someone. This only tells
    // the client whether to offer the prompt.
    const { count: duesInUse } = await supabase
      .from("player_payments")
      .select("id", { count: "exact", head: true })
      .eq("season_id", ctx.season.id);

    revalidatePath("/team");
    revalidatePath("/finance");
    revalidatePath("/dashboard");

    return {
      ok: true,
      playerId: created.id,
      playerName: player.full_name,
      needsDues: (duesInUse ?? 0) > 0 && player.person_type === "player",
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Assigns an EXISTING player to the current season. This is the path that
 * keeps returning players as one identity instead of a new record each year.
 */
export async function assignExistingPlayer(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const playerId = formData.get("player_id");
    if (!playerId) return { ok: false, error: "Pick a player to assign." };

    const { error } = await supabase.from("team_season_players").insert({
      player_id: playerId,
      team_id: ctx.team.id,
      season_id: ctx.season.id,
      jersey_number: int(formData.get("jersey_number")),
      is_active: true,
    });

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: "That player is already on this season's roster." };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Updates the persistent player and their current season assignment. */
export async function updateRosterMember(formData) {
  try {
    await guard();
    const supabase = createClient();

    const assignmentId = formData.get("assignment_id");
    const playerId = formData.get("player_id");
    if (!assignmentId || !playerId) return { ok: false, error: "Missing record reference." };

    const player = playerFields(formData);
    if (!player.full_name) return { ok: false, error: "Enter a name." };

    const { error: playerError } = await supabase
      .from("players")
      .update(player)
      .eq("id", playerId);

    if (playerError) return { ok: false, error: playerError.message };

    const { error: assignError } = await supabase
      .from("team_season_players")
      .update(assignmentFields(formData))
      .eq("id", assignmentId);

    if (assignError) return { ok: false, error: assignError.message };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Fast inline Active / Inactive toggle. Season-specific. */
export async function setRosterActive(formData) {
  try {
    await guard();
    const supabase = createClient();

    const assignmentId = formData.get("assignment_id");
    if (!assignmentId) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase
      .from("team_season_players")
      .update({ is_active: formData.get("is_active") === "true" })
      .eq("id", assignmentId);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Removes the season assignment. The player record is kept — they may have
 * history in other seasons, and removing someone from this year's roster is
 * not the same as deleting them from the organization.
 */
/**
 * Does this player have anything worth keeping in this season?
 *
 * "Meaningful" means the season actually happened for them: money that moved,
 * or activity on a field. Setup alone is not history.
 *
 * TOURNAMENT ROSTERS ARE DELIBERATELY NOT COUNTED HERE. Being pre-added to a
 * tournament during preseason planning is an intention, not a participation —
 * the real evidence of playing is a lineup slot or a plate appearance, and
 * those are checked. Treating a pre-add as history would make every player who
 * backed out permanently un-removable.
 */
async function seasonHistoryFor(supabase, playerId, seasonId) {
  const head = { count: "exact", head: true };

  const [paid, txns, pas, slots] = await Promise.all([
    // Actual payments live in payment_log, not on the dues row. A dues
    // obligation with nothing paid against it is setup, not history.
    supabase
      .from("payment_log")
      .select("id, player_payments!inner(player_id, season_id)", head)
      .eq("player_payments.player_id", playerId)
      .eq("player_payments.season_id", seasonId),
    supabase.from("budget_transactions").select("id", head)
      .eq("player_id", playerId).eq("season_id", seasonId),
    supabase.from("plate_appearances").select("id", head)
      .eq("player_id", playerId).eq("season_id", seasonId),
    supabase.from("game_lineup_slots").select("id", head)
      .eq("player_id", playerId).eq("season_id", seasonId),
  ]);

  const reasons = [];
  if (paid.count) reasons.push(`${paid.count} payment${paid.count === 1 ? "" : "s"}`);
  if (txns.count) reasons.push(`${txns.count} transaction${txns.count === 1 ? "" : "s"}`);
  if (pas.count) reasons.push(`${pas.count} tracked at-bat${pas.count === 1 ? "" : "s"}`);
  if (slots.count) reasons.push(`${slots.count} lineup appearance${slots.count === 1 ? "" : "s"}`);

  return { hasHistory: reasons.length > 0, reasons };
}

/**
 * Remove a player from one season, safely.
 *
 * THE DEFECT THIS REPLACES: removing a roster row deleted the membership and
 * nothing else. Dues and tournament entries have no foreign key to the
 * membership, so they survived — reachable by the database, invisible in the
 * UI, and counted by reporting as an "inactive player" who was never inactive.
 * Recovering one required re-adding the player, deleting the dues, and
 * removing them again. That is not a workflow anyone should have to know.
 *
 * Now the order of operations is the product's problem, not the coach's:
 *
 *   No meaningful history  -> setup cleanup. The unpaid dues obligation, the
 *                             tournament entries and the membership go
 *                             together, and the player record follows if
 *                             nothing anywhere else refers to it.
 *   Meaningful history     -> nothing is destroyed. The membership becomes
 *                             inactive, exactly as before.
 */
export async function removePlayerFromSeason(formData) {
  try {
    await guard();
    const supabase = createClient();

    const assignmentId = formData.get("assignment_id");
    if (!assignmentId) return { ok: false, error: "Missing record reference." };

    const { data: membership, error: readErr } = await supabase
      .from("team_season_players")
      .select("id, player_id, season_id")
      .eq("id", assignmentId)
      .maybeSingle();

    if (readErr) return { ok: false, error: readErr.message };
    if (!membership) return { ok: false, error: "That roster record no longer exists." };

    const { player_id: playerId, season_id: seasonId } = membership;

    const { hasHistory, reasons } = await seasonHistoryFor(supabase, playerId, seasonId);

    // --- Has history: preserve everything, mark inactive. -----------------
    if (hasHistory) {
      const { error } = await supabase
        .from("team_season_players")
        .update({ is_active: false })
        .eq("id", assignmentId);
      if (error) return { ok: false, error: error.message };

      revalidatePath("/team");
      revalidatePath("/finance");
      return { ok: true, outcome: "inactive", reasons };
    }

    // --- No history: setup cleanup, season-scoped throughout. -------------
    // Dues first: it is the record that used to be stranded.
    const dues = await supabase
      .from("player_payments")
      .delete()
      .eq("player_id", playerId)
      .eq("season_id", seasonId);
    if (dues.error) return { ok: false, error: dues.error.message };

    const tp = await supabase
      .from("tournament_participants")
      .delete()
      .eq("player_id", playerId)
      .eq("season_id", seasonId);
    if (tp.error) return { ok: false, error: tp.error.message };

    const gone = await supabase.from("team_season_players").delete().eq("id", assignmentId);
    if (gone.error) return { ok: false, error: gone.error.message };

    // The person record only goes if nothing anywhere still refers to it.
    // Checked AFTER the season records are removed, so this season no longer
    // counts as a reference.
    const head = { count: "exact", head: true };
    const [others, anyDues, anyDocs, anyTxn, anyPa, anyGuard] = await Promise.all([
      supabase.from("team_season_players").select("id", head).eq("player_id", playerId),
      supabase.from("player_payments").select("id", head).eq("player_id", playerId),
      supabase.from("documents").select("id", head).eq("player_id", playerId),
      supabase.from("budget_transactions").select("id", head).eq("player_id", playerId),
      supabase.from("plate_appearances").select("id", head).eq("player_id", playerId),
      supabase.from("player_guardians").select("id", head).eq("player_id", playerId),
    ]);

    const stillReferenced =
      (others.count ?? 0) + (anyDues.count ?? 0) + (anyDocs.count ?? 0) +
      (anyTxn.count ?? 0) + (anyPa.count ?? 0) + (anyGuard.count ?? 0);

    let removedPlayer = false;
    if (stillReferenced === 0) {
      const { error } = await supabase.from("players").delete().eq("id", playerId);
      // A failure here is not fatal: the season is already clean, and a
      // lingering person record with no season is recoverable. Reporting it as
      // an error would imply the removal did not happen.
      if (!error) removedPlayer = true;
    }

    revalidatePath("/team");
    revalidatePath("/finance");
    return { ok: true, outcome: "removed", removedPlayer };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Retained so nothing that still imports it breaks. It deletes ONLY the
 * membership, which is what created the orphans in the first place, so the UI
 * no longer calls it.
 *
 * @deprecated Use removePlayerFromSeason.
 */
export async function removeRosterMember(formData) {
  try {
    await guard();
    const supabase = createClient();

    const assignmentId = formData.get("assignment_id");
    if (!assignmentId) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase
      .from("team_season_players")
      .delete()
      .eq("id", assignmentId);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Permanently deletes a player identity. Only for records created by mistake.
 * Refuses if the player has any other season assignment, payment or document,
 * because those represent real history.
 */
export async function deletePlayerPermanently(formData) {
  try {
    await guard();
    const supabase = createClient();

    const playerId = formData.get("player_id");
    const assignmentId = formData.get("assignment_id");
    if (!playerId) return { ok: false, error: "Missing record reference." };

    const head = { count: "exact", head: true };

    const [seasons, payments, documents] = await Promise.all([
      supabase.from("team_season_players").select("id", head).eq("player_id", playerId),
      supabase.from("player_payments").select("id", head).eq("player_id", playerId),
      supabase.from("documents").select("id", head).eq("player_id", playerId),
    ]);

    const otherSeasons = (seasons.count ?? 0) - (assignmentId ? 1 : 0);
    const blockers = [];
    if (otherSeasons > 0) blockers.push(`${otherSeasons} other season assignment${otherSeasons === 1 ? "" : "s"}`);
    if (payments.count) blockers.push(`${payments.count} payment record${payments.count === 1 ? "" : "s"}`);
    if (documents.count) blockers.push(`${documents.count} document${documents.count === 1 ? "" : "s"}`);

    if (blockers.length) {
      return {
        ok: false,
        error: `This player has ${blockers.join(", ")}. Remove them from the roster instead — that keeps their history.`,
      };
    }

    const { error } = await supabase.from("players").delete().eq("id", playerId);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Imports a roster from CSV.
 *
 * Deliberately narrow for alpha: five fixed columns, no mapping UI. A coach
 * pasting a spreadsheet wants a roster in one step, not a field-mapping
 * exercise. Anything richer belongs in the player form.
 *
 * Rows are validated and reported individually — one bad row never blocks the
 * rest, and every skip is explained by name so the coach can fix it or add
 * that person by hand.
 *
 * Reuses the same two writes as addRosterMember: a persistent players row,
 * then the season assignment. No new schema.
 */
export async function importRoster(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    let rows;
    try {
      rows = JSON.parse((formData.get("rows") ?? "[]").toString());
    } catch {
      return { ok: false, error: "That file couldn't be read. Try downloading the template." };
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "No rows found in that file." };
    }

    if (rows.length > 200) {
      return { ok: false, error: "That's more than 200 rows. Split the file and import in batches." };
    }

    // Existing names, so a re-import doesn't duplicate anyone.
    const { data: existing } = await supabase
      .from("players")
      .select("id, full_name")
      .eq("organization_id", ctx.organization.id);

    const byName = new Map(
      (existing ?? []).map((p) => [p.full_name?.trim().toLowerCase(), p.id])
    );

    const { data: assigned } = await supabase
      .from("team_season_players")
      .select("player_id")
      .eq("season_id", ctx.season.id);

    const onRoster = new Set((assigned ?? []).map((r) => r.player_id));

    const added = [];
    const skipped = [];
    const seen = new Set();

    for (const raw of rows) {
      const name = (raw.name ?? "").toString().trim();

      if (!name) {
        skipped.push({ name: "(no name)", reason: "no name in this row" });
        continue;
      }

      const key = name.toLowerCase();

      if (seen.has(key)) {
        skipped.push({ name, reason: "listed twice in this file" });
        continue;
      }
      seen.add(key);

      const existingId = byName.get(key);

      if (existingId && onRoster.has(existingId)) {
        skipped.push({ name, reason: "already on this roster" });
        continue;
      }

      const jersey = Number.parseInt(raw.jersey, 10);
      const grad = Number.parseInt(raw.grad_year, 10);
      const positions = (raw.positions ?? "")
        .toString()
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean);

      const text_ = (v) => (v ?? "").toString().trim() || null;

      let playerId = existingId;

      // Reuse an existing person rather than creating a second record — this
      // is the same identity rule the pickup flow follows.
      if (!playerId) {
        const { data: created, error: playerError } = await supabase
          .from("players")
          .insert({
            organization_id: ctx.organization.id,
            full_name: name,
            person_type: "player",
            grad_year: Number.isFinite(grad) ? grad : null,
            // date_of_birth is deliberately not importable. A minor's identity
            // data does not belong in a bulk spreadsheet — same reasoning that
            // removed the Birth Certificate document category.
            throws: text_(raw.throws),
            bats: text_(raw.bats),
            player_email: text_(raw.player_email),
            player_phone: text_(raw.player_phone),
            parent_name: text_(raw.parent_name),
            parent_email: text_(raw.parent_email),
            parent_phone: text_(raw.parent_phone),
            notes: text_(raw.notes),
          })
          .select("id")
          .single();

        if (playerError) {
          skipped.push({ name, reason: "couldn't be saved" });
          continue;
        }
        playerId = created.id;
      }

      const { error: assignError } = await supabase.from("team_season_players").insert({
        player_id: playerId,
        team_id: ctx.team.id,
        season_id: ctx.season.id,
        is_active: true,
        jersey_number: Number.isFinite(jersey) ? jersey : null,
        positions: positions.length ? positions : null,
        jersey_size: text_(raw.jersey_size),
        pants_size: text_(raw.pants_size),
      });

      if (assignError) {
        skipped.push({ name, reason: "couldn't be added to the roster" });
        continue;
      }

      added.push(name);
    }

    revalidatePath("/team");
    revalidatePath("/dashboard");
    return { ok: true, added: added.length, skipped };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
