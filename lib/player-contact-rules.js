/**
 * Player contact resolution — ONE definition, consumed by every surface.
 *
 * Two stores hold the same kind of information. `player_contacts` (Migration A)
 * is the real one: many contacts, ordered, with a primary. The three legacy
 * columns `players.parent_name/parent_email/parent_phone` predate it and still
 * hold the only contact details for 25 production players until C3b backfills
 * them.
 *
 * Roster and readiness previously each decided for themselves what "has
 * contact information" meant, and they did not agree: the roster counted
 * `player_phone` and `parent_name`, readiness counted neither. No production
 * row exposed the difference, which is exactly why it survived. Both surfaces
 * now import from here.
 *
 * SOURCE PRECEDENCE IS ROW-LEVEL, NEVER FIELD-LEVEL. If a player has any
 * `player_contacts` row, the legacy columns are ignored completely. Merging
 * per-field — taking `parent_phone` because the contact row has no phone —
 * reads as helpful and is a trap: a coach who corrects a number in the new
 * system would see the stale one reappear beside it with nothing to say which
 * is current. One record wins whole.
 *
 * NOTHING HERE WRITES. A derived primary is a display decision for one render;
 * it is never persisted, so reading a roster can never change what the next
 * reader sees.
 */

/** Trim to null. A whitespace-only column is absent, not present-and-blank. */
const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Order contacts so the primary is first and the rest are stable.
 *
 * The chain is a TOTAL order — sort_order, then created_at, then id — so the
 * same rows always produce the same primary regardless of the order the
 * database, the network or a test fixture happened to deliver them in. A
 * derived primary that moved between renders would be worse than no primary.
 */
function compareContacts(a, b) {
  if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;

  const ao = Number.isFinite(a.sort_order) ? a.sort_order : 0;
  const bo = Number.isFinite(b.sort_order) ? b.sort_order : 0;
  if (ao !== bo) return ao - bo;

  const at = a.created_at ? String(a.created_at) : "";
  const bt = b.created_at ? String(b.created_at) : "";
  if (at !== bt) return at < bt ? -1 : 1;

  const ai = a.id ? String(a.id) : "";
  const bi = b.id ? String(b.id) : "";
  if (ai !== bi) return ai < bi ? -1 : 1;
  return 0;
}

/** A stored contact row, normalised. `full_name` may legitimately be null. */
function fromRow(row) {
  return {
    id: row.id ?? null,
    full_name: clean(row.full_name),
    relationship: clean(row.relationship),
    email: clean(row.email),
    phone: clean(row.phone),
    preferred_method: clean(row.preferred_method),
    is_primary: row.is_primary === true,
    isPrimaryDerived: false,
    source: "player_contacts",
  };
}

/**
 * The legacy columns as at most ONE contact.
 *
 * `full_name` stays null when `parent_name` is null — 16 of the 25 production
 * rows are in exactly that state. Manufacturing "Parent/Guardian" or "Parent
 * of Ava" would put a string a coach never typed in front of them, looking
 * like recorded data. Relationship was never captured by these columns, so it
 * is null rather than guessed.
 */
function fromLegacy(player) {
  const full_name = clean(player.parent_name);
  const email = clean(player.parent_email);
  const phone = clean(player.parent_phone);
  if (full_name === null && email === null && phone === null) return null;

  return {
    id: null,
    full_name,
    relationship: null,
    email,
    phone,
    preferred_method: null,
    is_primary: false,
    isPrimaryDerived: true,
    source: "legacy",
  };
}

/**
 * Resolve every contact detail for one player.
 *
 * Accepts the player record as `listSeasonRoster` returns it, with the
 * embedded `player_contacts` array. A missing array is treated as none, so a
 * caller that has not been migrated yet degrades to the legacy path rather
 * than throwing.
 */
export function resolvePlayerContact(player) {
  const p = player ?? {};
  const rows = Array.isArray(p.player_contacts) ? p.player_contacts : [];

  let contacts;
  let source;

  // player_contacts IS THE SOURCE. The legacy parent_* columns are no longer
  // consulted here at all.
  //
  // They used to be a fallback for a player with no rows, which was right
  // while the migration was outstanding and wrong the moment it completed:
  // deleting a coach's last guardian dropped the row count to zero, the
  // resolver fell through, and the same name and email reappeared — this time
  // as source "legacy" with a null id, so the Remove button disappeared and
  // the guardian could not be deleted again. A coach removed a contact and
  // watched it come back undeletable.
  //
  // The backfill (20260823201733) selected every player with any parent_*
  // value and no existing contact, with no exclusion. Production confirms it
  // ran completely: 25 players were eligible, 23 backfilled rows survive, and
  // the 2 without contacts are ones whose rows were deliberately deleted
  // afterwards. No player depends on the fallback to show a real guardian.
  //
  // parent_* is left untouched as historical data. Nothing writes it, and now
  // nothing reads it for display either.
  contacts = rows.map(fromRow).sort(compareContacts);
  source = rows.length > 0 ? "player_contacts" : "none";

  if (rows.length > 0) {

    // No stored primary: pick deterministically for display only. The partial
    // unique index makes two primaries impossible, so this is the sole case.
    if (!contacts.some((c) => c.is_primary)) {
      contacts[0] = { ...contacts[0], isPrimaryDerived: true };
    }
  }

  const primary = contacts[0] ?? null;

  const playerEmail = clean(p.player_email);
  const playerPhone = clean(p.player_phone);

  /**
   * REACHABLE: is there any way to actually contact this family?
   *
   * A channel only — an email or a phone number, on the player or on any
   * contact. A name is not a way to reach anyone, which is why it is excluded.
   * `player_phone` IS included: the old readiness rule counted `player_email`
   * but not `player_phone`, so a player reachable only by phone was reported
   * as having no contact details. No production row hit it; the rule was wrong
   * regardless.
   */
  const reachable = Boolean(
    playerEmail ||
      playerPhone ||
      contacts.some((c) => c.email || c.phone)
  );

  /**
   * HAS ANY DETAIL: is there anything worth rendering a section for?
   *
   * Deliberately broader than `reachable` — a guardian's name with no number
   * is worth showing and is not a way to reach them. These are two questions,
   * not two opinions: both derive from the list resolved above, so the roster
   * and readiness cannot disagree about what a player actually has.
   */
  const hasAnyDetail = Boolean(
    reachable || contacts.some((c) => c.full_name || c.relationship)
  );

  return { contacts, primary, source, reachable, hasAnyDetail };
}

/** Readiness asks only this. One call site, one meaning. */
export function isReachable(player) {
  return resolvePlayerContact(player).reachable;
}
