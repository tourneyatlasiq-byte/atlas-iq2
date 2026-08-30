"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import { resolvePlayerContact } from "../player-contact-rules";

/**
 * Parent / guardian contact writes.
 *
 * player_contacts is the ONLY store these touch. players.parent_name,
 * parent_email and parent_phone are legacy read-fallback columns after C3b and
 * nothing here writes them — not as a mirror, not as a backup. Two stores for
 * one fact is what produced the split-write state these actions exist to end.
 *
 * Contact selection and ordering are NOT reimplemented here.
 * resolvePlayerContact() from C3a is the single definition, so the editor can
 * never disagree with the roster drawer or the readiness list about what a
 * player has.
 */

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to contacts.");
  return ctx;
}

const text = (v) => {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
};

const METHODS = ["text", "email", "call"];

/** The four fields that make a contact worth storing. */
const DETAIL_FIELDS = ["full_name", "relationship", "email", "phone"];
const hasDetail = (c) => DETAIL_FIELDS.some((k) => text(c[k]) !== null);

/**
 * Read one player's contacts under RLS and resolve them through C3a.
 *
 * The legacy columns are selected because resolvePlayerContact() needs them to
 * build the fallback contact — the one that materialization turns into a real
 * row.
 */
async function resolveFor(supabase, playerId) {
  const { data, error } = await supabase
    .from("players")
    .select(
      `id, organization_id, parent_name, parent_email, parent_phone,
       player_contacts ( id, full_name, relationship, email, phone,
                         preferred_method, is_primary, sort_order, created_at )`
    )
    .eq("id", playerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("That player no longer exists.");
  return { player: data, resolved: resolvePlayerContact(data) };
}

function readForm(formData) {
  const out = {
    full_name: text(formData.get("full_name")),
    relationship: text(formData.get("relationship")),
    email: text(formData.get("email")),
    phone: text(formData.get("phone")),
    preferred_method: text(formData.get("preferred_method")),
  };
  if (out.preferred_method && !METHODS.includes(out.preferred_method)) {
    throw new Error("Choose a valid preferred contact method.");
  }
  return out;
}

/** Adds a contact. Never becomes primary implicitly — see setPrimaryContact. */
export async function addPlayerContact(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const playerId = formData.get("player_id");
    if (!playerId) return { ok: false, error: "Missing record reference." };

    const fields = readForm(formData);
    if (!hasDetail(fields)) {
      return { ok: false, error: "Enter a name, relationship, email or phone number." };
    }

    const { resolved } = await resolveFor(supabase, playerId);

    // A brand-new contact is primary ONLY when the player genuinely has none
    // stored. A legacy fallback is not a stored contact, so the first real row
    // for a legacy-only player correctly claims primary.
    const stored = resolved.contacts.filter((c) => c.source === "player_contacts");
    const nextSort = stored.length
      ? Math.max(...stored.map((c) => c.sort_order ?? 0)) + 1
      : 0;

    const { error } = await supabase.from("player_contacts").insert({
      organization_id: ctx.organization.id,
      player_id: playerId,
      ...fields,
      is_primary: stored.length === 0,
      sort_order: stored.length === 0 ? 0 : nextSort,
      created_by: ctx.profile?.id ?? null,
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Updates one contact, or MATERIALIZES the legacy one.
 *
 * A resolver contact with source "legacy" has no row behind it — it is
 * players.parent_* presented as a contact. Editing it inserts a real row.
 *
 * THE INSERT IS BUILT FROM THE WHOLE RESOLVED CONTACT, then the submitted
 * edits are layered on top. Building it from the submitted fields alone would
 * mean a coach who corrects only the phone number silently loses the legacy
 * name and email, because the form for that one field is all the server would
 * see. The legacy columns are left byte-unchanged either way.
 */
export async function updatePlayerContact(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const playerId = formData.get("player_id");
    const contactId = text(formData.get("contact_id"));   // null => the legacy one
    if (!playerId) return { ok: false, error: "Missing record reference." };

    const fields = readForm(formData);
    const { resolved } = await resolveFor(supabase, playerId);

    if (contactId === null) {
      const legacy = resolved.contacts.find((c) => c.source === "legacy");
      if (!legacy) return { ok: false, error: "That contact no longer exists." };

      // BLANK MEANS CLEAR, exactly as it does for an ordinary contact.
      //
      // This used to read `fields.email ?? legacy.email`, so clearing a field
      // silently restored the old value: the same Edit button behaved
      // differently depending on where the contact came from, and a coach
      // correcting a wrong email on a legacy record could not.
      //
      // The form submits every field, so what arrives IS the intended state.
      // Import's blank-no-erase rule is deliberately not reused here — an
      // import cannot see what it is overwriting and a coach can.
      const merged = { ...fields };

      if (!hasDetail(merged)) {
        return {
          ok: false,
          code: "would_be_empty",
          error: "This would leave the contact empty.",
        };
      }

      const { error } = await supabase.from("player_contacts").insert({
        organization_id: ctx.organization.id,
        player_id: playerId,
        ...merged,
        // The legacy contact was the player's only one, so the row that
        // replaces it is primary. Nothing is displaced.
        is_primary: true,
        sort_order: 0,
        created_by: ctx.profile?.id ?? null,
      });

      if (error) return { ok: false, error: error.message };

      revalidatePath("/team");
      return { ok: true, materialized: true };
    }

    // --- An existing authoritative row. -----------------------------------
    const target = resolved.contacts.find((c) => c.id === contactId);
    if (!target) return { ok: false, error: "That contact no longer exists." };

    // Blank means CLEAR here: this editor edits one named contact and the
    // coach can see exactly what they are changing. That is the supported
    // clear operation, and it is why the generic player form no longer
    // carries contact fields at all.
    const next = { ...fields };
    if (!hasDetail(next)) {
      // A distinct CODE, not just a sentence. The panel used to render this
      // as a generic error above the card — which on a phone sat off the top
      // of the screen, so Save appeared to do nothing at all. The caller uses
      // the code to offer removal beside the form instead.
      return {
        ok: false,
        code: "would_be_empty",
        error: "This would leave the contact empty.",
      };
    }

    // is_primary is deliberately absent: an ordinary edit never changes which
    // contact is primary, and a derived primary is never written.
    const { data: updated, error } = await supabase
      .from("player_contacts")
      .update(next)
      .eq("id", contactId)
      .eq("player_id", playerId)     // a foreign id cannot match
      .select("id");

    if (error) return { ok: false, error: error.message };
    if ((updated ?? []).length === 0) {
      return { ok: false, error: "That contact could not be updated." };
    }

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Removes one contact. Explicit only — no blank field ever deletes a row.
 *
 * Removing the primary does NOT promote a replacement. C3a's deterministic
 * rule decides what displays as primary until the coach chooses one, which
 * keeps promotion an explicit act rather than a side effect of a deletion.
 */
export async function removePlayerContact(formData) {
  try {
    await guard();
    const supabase = createClient();

    const playerId = formData.get("player_id");
    const contactId = text(formData.get("contact_id"));
    if (!playerId || !contactId) return { ok: false, error: "Missing record reference." };

    const { data: deleted, error } = await supabase
      .from("player_contacts")
      .delete()
      .eq("id", contactId)
      .eq("player_id", playerId)
      .select("id");

    if (error) return { ok: false, error: error.message };
    // Affected rows, not the absence of an error — the lesson from the
    // permanent-delete defect, which reported success on a zero-row delete.
    if ((deleted ?? []).length === 0) {
      return { ok: false, error: "That contact could not be removed." };
    }

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Makes one contact primary — the ONLY path that changes which contact is
 * primary.
 *
 * Delegated to set_primary_contact() rather than done here. This used to be
 * two sequential PostgREST calls, demote then promote; a failure between them
 * left the player with no explicit primary. C3a's deterministic rule made
 * that degrade to a display default rather than a broken record, but the
 * window should not exist. The RPC is one transaction: either the primary
 * moves or nothing does.
 *
 * Promoting the contact that is already primary is an idempotent success, so
 * a double click cannot churn the row.
 */
export async function setPrimaryContact(formData) {
  try {
    await guard();
    const supabase = createClient();

    const playerId = formData.get("player_id");
    const contactId = text(formData.get("contact_id"));
    if (!playerId || !contactId) return { ok: false, error: "Missing record reference." };

    const { data, error } = await supabase.rpc("set_primary_contact", {
      p_player_id: playerId,
      p_contact_id: contactId,
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath("/team");
    return { ok: true, changed: data?.changed ?? false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
