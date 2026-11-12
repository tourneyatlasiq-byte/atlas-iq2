/**
 * Offline QAB queue recovery rules (ST-022, 2026-11).
 *
 * Pure: no IndexedDB, no server imports. Shared by the server actions (to
 * classify a failure) and by the queue and tracker (to decide what to do with
 * it), so both sides read one definition and the rules are testable without a
 * browser or a database.
 *
 * The problem this solves: every failure used to be treated alike, so a write
 * the database will never accept retried forever and, because replay stops at
 * the first failure, blocked every write behind it.
 */

/* ---------- Classifying a failure ---------- */

/**
 * Codes for failures that will not succeed by retrying. Each becomes "Needs
 * review" in the tracker; none is ever retried automatically.
 */
export const PERMANENT_CODES = [
  "slot_taken",    // another plate appearance already holds this batter's PA number
  "game_complete", // QAB tracking was finished for this game
  "past_season",   // the season is read-only
  "not_allowed",   // role or feature does not permit it
  "not_found",     // the game, player or plate appearance no longer exists
  "stale",         // the saved entry changed since this correction was made
  "invalid",       // the write itself breaks a rule (malformed, too many reasons)
];

/**
 * A database error as { code, retryable }.
 *
 * Known rule violations are permanent. Anything else — connection loss,
 * timeouts, server errors, an unrecognised code — is treated as transient,
 * because retrying a write can never lose data, while wrongly calling it
 * permanent would put a recoverable write in front of the coach.
 */
export function classifyDbError(error) {
  const code = error?.code ?? "";
  const msg = String(error?.message ?? "");
  if (code === "23505") return { code: "slot_taken", retryable: false };
  if (code === "23514") return { code: "invalid", retryable: false };
  if (code === "23503") return { code: "not_found", retryable: false };
  if (code === "42501" || /row-level security/i.test(msg)) return { code: "not_allowed", retryable: false };
  if (code === "P0001") {
    if (/tracking is complete/i.test(msg)) return { code: "game_complete", retryable: false };
    if (/season has finished|past season|read-only/i.test(msg)) return { code: "past_season", retryable: false };
    if (/could not be found/i.test(msg)) return { code: "not_found", retryable: false };
    return { code: "invalid", retryable: false };
  }
  return { code: "server", retryable: true };
}

/**
 * A thrown error inside a server action as { code, retryable }.
 * A sign-in redirect is transient: it succeeds once the coach signs in again.
 */
export function classifyThrown(e) {
  const digest = String(e?.digest ?? "");
  const msg = String(e?.message ?? "");
  if (digest.startsWith("NEXT_REDIRECT") || msg === "NEXT_REDIRECT") return { code: "auth", retryable: true };
  if (/role doesn't allow/i.test(msg)) return { code: "not_allowed", retryable: false };
  if (/past season, which is read-only/i.test(msg)) return { code: "past_season", retryable: false };
  if (/could not be found/i.test(msg)) return { code: "not_found", retryable: false };
  if (/No organization is linked|has no team yet|has no season yet/i.test(msg)) return { code: "not_allowed", retryable: false };
  return { code: "server", retryable: true };
}

/**
 * What one attempt came to.
 *   ok        — delivered (or provably already delivered)
 *   permanent — will never succeed by retrying: Needs review
 *   transient — retry later, with backoff
 * `thrown` is set when the request itself failed (offline, network).
 */
export function classifyAttempt(result, thrown = null) {
  if (thrown) return { kind: "transient", code: "network" };
  if (result?.ok) return { kind: "ok", code: null };
  if (result?.retryable === false) return { kind: "permanent", code: result.code ?? "invalid" };
  return { kind: "transient", code: result?.code ?? "server" };
}

/** Delay before the next automatic retry: 2s, 4s, 8s… capped at 2 minutes. */
export function backoffMs(attempts) {
  const n = Math.max(1, attempts ?? 1);
  return Math.min(2000 * 2 ** (n - 1), 120000);
}

/* ---------- Dependencies between queued writes ---------- */

/** The plate appearance a queued write refers to, and for a record its slot. */
export function entryKeys(entry) {
  const p = entry?.payload ?? {};
  const keys = [];
  if (p.id) keys.push(`id:${p.id}`);
  if (entry?.op === "record" && p.playerId && p.paNumber != null) keys.push(`slot:${p.playerId}:${p.paNumber}`);
  return keys;
}

const shares = (a, b) => entryKeys(a).some((k) => entryKeys(b).includes(k));

/**
 * A write and every LATER write that depends on it (same plate appearance id,
 * or a record in the same slot). Resolving or discarding a write always takes
 * its dependents with it, so nothing is left pointing at a write that is gone.
 */
export function dependencyGroup(entries, head) {
  const later = entries.filter((e) => e.seq > head.seq).sort((a, b) => a.seq - b.seq);
  const group = [head];
  for (const e of later) if (group.some((g) => shares(g, e))) group.push(e);
  return group;
}

/* ---------- Ownership ---------- */

/**
 * Whose write this is, relative to the signed-in user.
 *   mine    — queued by this user: may be sent
 *   other   — queued by a different user: never sent under this user
 *   unknown — queued before identities were stored: never sent automatically
 */
export function ownership(entry, userId) {
  if (!entry?.userId) return "unknown";
  return entry.userId === userId ? "mine" : "other";
}

/* ---------- Provably safe automatic resolution ---------- */

/**
 * Same rule as sameNote() in lib/qab-rules.js (trimmed; blank equals none).
 * Kept local so this module stays import-free; check-qab-notes asserts the
 * two agree.
 */
export const sameNote = (a, b) => (a == null ? "" : String(a).trim()) === (b == null ? "" : String(b).trim());

const sameReasons = (a, b) =>
  JSON.stringify([...new Set(a ?? [])].sort()) === JSON.stringify([...new Set(b ?? [])].sort());

/** The saved, live plate appearance already holding this record's slot, if any. */
export function savedInSlot(entry, savedRows = []) {
  const p = entry?.payload ?? {};
  if (entry?.op !== "record") return null;
  return (
    savedRows.find(
      (r) => !r.voided_at && r.player_id === p.playerId && r.pa_number === p.paNumber && r.id !== p.id
    ) ?? null
  );
}

/**
 * Writes that can be removed from the queue with NO server write and NO change
 * to QAB data. Only two cases qualify:
 *
 *   cancelled    — a record that has never been sent, followed by a void of
 *                  the same plate appearance (and anything between them on it
 *                  also never sent). The pair nets to nothing.
 *   alreadySaved — a record whose slot already holds a saved plate appearance
 *                  with the same reason, batting position and note, with nothing
 *                  queued after it that refers to it.
 *
 * Ownership does not matter for either: nothing is sent.
 * Returns [{ seqs, reason }].
 */
export function safeResolutions(entries, savedRows = []) {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const out = [];
  const taken = new Set();
  const unsent = (e) => (e.attempts ?? 0) === 0 && !e.lastError;

  for (const e of sorted) {
    if (taken.has(e.seq) || e.op !== "record") continue;
    const group = dependencyGroup(sorted, e);

    const onId = group.filter((g) => g.payload?.id === e.payload?.id);
    const last = onId[onId.length - 1];
    if (onId.length > 1 && last.op === "void" && onId.every(unsent) && group.length === onId.length) {
      out.push({ seqs: onId.map((g) => g.seq), reason: "cancelled" });
      onId.forEach((g) => taken.add(g.seq));
      continue;
    }

    const saved = savedInSlot(e, savedRows);
    if (
      saved &&
      group.length === 1 &&
      sameReasons(saved.qab_reasons, e.payload?.reasons) &&
      (saved.batting_order ?? null) === (e.payload?.battingOrder ?? null) &&
      // A different note (or a note on only one side) is a conflict for the
      // coach to decide, never resolved by dropping a note (2026-11).
      sameNote(saved.notes, e.payload?.notes)
    ) {
      out.push({ seqs: [e.seq], reason: "already_saved" });
      taken.add(e.seq);
    }
  }
  return out;
}
