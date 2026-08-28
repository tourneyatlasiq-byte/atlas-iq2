"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
// The canonical derivation, reused rather than reimplemented. A second
// implementation here is exactly how full_name would drift from the
// structured columns.
import { composeFullName, hasStructuredName } from "../intake/normalize";

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

/**
 * The name columns, in whichever mode this record is in.
 *
 * STRUCTURED NAMES ARE AUTHORITATIVE WHEN THEY EXIST. A record that has them
 * must keep full_name derived from them — nameIsConsistent() in
 * lib/intake/normalize.js states the invariant, and this is where a manual
 * edit would otherwise break it. The edit form wrote full_name and never
 * touched legal_first_name / preferred_first_name / last_name, so renaming an
 * imported player left the structured columns behind holding the old name.
 *
 * NOTHING IS PARSED. full_name is never split into components: "Mary Ann van
 * der Berg" has no reliable answer, and a wrong guess would be written to the
 * record as though the coach had entered it. A legacy player therefore stays a
 * legacy player until a real first and last name are supplied.
 *
 * WHICH MODE IS DECIDED BY THE FORM, not by this function inventing one. The
 * structured form posts last_name; the legacy form posts full_name. A payload
 * carrying both is treated as structured, because structured wins wherever it
 * exists.
 */
function nameFields(formData) {
  const submittedStructured =
    formData.has("last_name") || formData.has("legal_first_name") ||
    formData.has("preferred_first_name");

  if (!submittedStructured) {
    // LEGACY, unchanged: one Name field, no structured columns written.
    return { ok: true, values: { full_name: text(formData.get("full_name")) } };
  }

  const legal_first_name     = text(formData.get("legal_first_name"));
  const preferred_first_name = text(formData.get("preferred_first_name"));
  const last_name            = text(formData.get("last_name"));

  // composeFullName() falls back to full_name when it cannot compose, and
  // full_name is NOT NULL. Requiring the parts it needs keeps the derivation
  // total and means the fallback is unreachable here. The condition mirrors
  // hasStructuredName() exactly, so an imported record with a preferred name
  // but no legal one stays editable.
  if (!last_name || !(legal_first_name || preferred_first_name)) {
    return { ok: false, error: "Enter a first and last name." };
  }

  // full_name is DERIVED. Any full_name in the payload is ignored outright, so
  // a tampered or stale value cannot win over the structured columns.
  const full_name = composeFullName({
    legal_first_name, preferred_first_name, last_name,
  });

  return { ok: true, values: { legal_first_name, preferred_first_name, last_name, full_name } };
}

/**
 * Player columns written by the add and edit forms.
 *
 * parent_name, parent_email and parent_phone are DELIBERATELY ABSENT. They are
 * legacy read-fallback columns after C3b; player_contacts is the sole contact
 * write store and lib/actions/player-contacts.js is the only thing that writes
 * it. Reintroducing them here would recreate the split-write state where a
 * coach's correction landed in a column the drawer no longer reads.
 *
 * This helper is shared by addRosterMember and updateRosterMember, so removing
 * them here closes both paths at once.
 *
 * Returns { ok: false, error } when the name is unusable, so the caller can
 * report it rather than writing a half-named record.
 */
function playerFields(formData) {
  const name = nameFields(formData);
  if (!name.ok) return name;

  return {
    ok: true,
    values: {
      ...name.values,
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
      notes: text(formData.get("notes")),
      // Mailing address. Colleges post recruiting material to the player, so
      // it lives on the player rather than on a guardian contact.
      street_address: text(formData.get("street_address")),
      street_address_2: text(formData.get("street_address_2")),
      city: text(formData.get("city")),
      state: text(formData.get("state")),
      zip: text(formData.get("zip")),
    },
  };
}

/**
 * The optional single contact offered on Add Player.
 *
 * Only on ADD. A brand-new player provably has no contacts, so creating one
 * primary row is unambiguous. Editing contacts on an existing player is a
 * different problem — several contacts, an explicit primary — and belongs to
 * the dedicated editor, not to a generic person form.
 *
 * Returns null when nothing was entered. No contact information is a valid
 * state and must not produce an empty row.
 */
function initialContactFields(formData) {
  const c = {
    full_name: text(formData.get("contact_full_name")),
    relationship: text(formData.get("contact_relationship")),
    email: text(formData.get("contact_email")),
    phone: text(formData.get("contact_phone")),
  };
  return Object.values(c).some((v) => v !== null) ? c : null;
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

/**
 * Creates a new persistent player, their season assignment and an optional
 * primary contact — as ONE transaction.
 *
 * This used to be two sequential inserts with a compensating DELETE on
 * failure. That DELETE could never work: `players` has no DELETE policy
 * (#177), and a zero-row delete raises nothing, so every failed assignment
 * left an orphaned person record behind silently. roster_add_member() makes
 * the whole thing one function body, which is one transaction.
 *
 * Contact information goes to player_contacts. players.parent_* is never
 * written.
 */
export async function addRosterMember(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const named = playerFields(formData);
    if (!named.ok) return { ok: false, error: named.error };
    const player = named.values;
    if (!player.full_name) return { ok: false, error: "Enter a name." };

    // roster_add_member accepts high_school and the address columns as of
    // 20260828184552, so the Add form no longer silently drops them.
    player.high_school = text(formData.get("high_school"));

    const { data, error } = await supabase.rpc("roster_add_member", {
      p_team_id: ctx.team.id,          // SERVER context, never the request
      p_season_id: ctx.season.id,
      p_player: player,
      p_assignment: assignmentFields(formData),
      p_contact: initialContactFields(formData),
    });

    if (error) return { ok: false, error: error.message };

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
      playerId: data?.player_id,
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

    const named = playerFields(formData);
    if (!named.ok) return { ok: false, error: named.error };
    const player = named.values;
    if (!player.full_name) return { ok: false, error: "Enter a name." };

    // Blank clears, which is the semantics every other field on this form
    // already has: the input shows the stored value, so emptying it is a
    // deliberate act by a coach who can see what they are removing. That is
    // the opposite of the import path, where an absent column means "not
    // mentioned" and must never erase.
    player.high_school = text(formData.get("high_school"));

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

    // AFFECTED ROWS, NOT THE ABSENCE OF AN ERROR.
    //
    // `players` has no DELETE policy — removed deliberately by #177 to protect
    // person records. A DELETE matching no rows is not an error in Postgres or
    // PostgREST, so this returned error: null and reported removedPlayer: true
    // while the row was still there. The coach was told a record had been
    // deleted that had not been.
    //
    // .select("id") makes the delete return what it actually removed, so an
    // empty array is an honest "nothing was deleted". The season removal above
    // genuinely succeeded either way, which is why that stays ok: true — only
    // the claim about the person record becomes truthful.
    let removedPlayer = false;
    if (stillReferenced === 0) {
      const { data: deletedRows } = await supabase
        .from("players")
        .delete()
        .eq("id", playerId)
        .select("id");
      removedPlayer = (deletedRows ?? []).length > 0;
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
 * Permanent player deletion was REMOVED, not fixed.
 *
 * `players` has no DELETE policy. That is deliberate — #177
 * (guard_03_parent_scoped_policies) split the original FOR ALL policy
 * specifically so DELETE had none, and the player_contacts RLS migration
 * reaffirmed it: person records are a deliberate exception.
 *
 * deletePlayerPermanently() was written after that and could therefore never
 * work. A DELETE matching zero rows is not an error, so it returned ok: true
 * having deleted nothing, and told the coach the player was erased forever.
 *
 * Restoring the capability would mean granting DELETE on `players`, and the
 * dependency audit showed that is not a small change: game_lineup_slots
 * CASCADEs (destroying lineup history for a player with no plate appearances,
 * which are RESTRICTed) and budget_transactions SET NULL (silently stripping a
 * financial record of its player). The action checked neither. The missing
 * policy had been protecting production from a delete path that was never
 * safe.
 *
 * Remove from roster is the supported workflow: it clears setup-only records,
 * preserves anything paid or played, and is what the button now offers. An
 * archive/soft-delete model can be designed later if a real need appears.
 */

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

      // NEW player: one atomic operation, the same one Add Player uses.
      // Player, season assignment and the optional contact share a
      // transaction, so a row that fails part-way leaves nothing behind.
      // Contact details go to player_contacts; parent_* is never written.
      if (!existingId) {
        const { error: rpcError } = await supabase.rpc("roster_add_member", {
          p_team_id: ctx.team.id,
          p_season_id: ctx.season.id,
          p_player: {
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
            notes: text_(raw.notes),
          },
          p_assignment: {
            is_active: true,
            jersey_number: Number.isFinite(jersey) ? jersey : null,
            positions: positions.length ? positions : null,
            jersey_size: text_(raw.jersey_size),
            pants_size: text_(raw.pants_size),
          },
          p_contact: (() => {
            const c = {
              full_name: text_(raw.parent_name),
              relationship: null,
              email: text_(raw.parent_email),
              phone: text_(raw.parent_phone),
            };
            return Object.values(c).some((v) => v !== null) ? c : null;
          })(),
        });

        if (rpcError) {
          skipped.push({ name, reason: "couldn't be saved" });
          continue;
        }

        added.push(name);
        continue;
      }

      // EXISTING player: assign to the season and NOTHING else.
      //
      // Their contact information is deliberately untouched. A bulk file is
      // not evidence that a stored contact should be overwritten, and a
      // spreadsheet column left blank is not an instruction to erase one.
      const { error: assignError } = await supabase.from("team_season_players").insert({
        player_id: existingId,
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
