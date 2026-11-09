"use client";

/**
 * Durable write queue for QAB tracking.
 *
 * A coach standing at a fence has one bar of signal or none. Every tap must
 * land locally and instantly; the network is a background concern. So the
 * order is always: generate the id, write to IndexedDB, update the UI, then
 * try to sync.
 *
 * The client-generated PA uuid is the whole idempotency story. It exists
 * before any request leaves the phone, so a retry after a dropped response
 * conflicts with the row it already wrote and does nothing. Nothing here
 * invents an id, and nothing here discards a write it could not deliver.
 *
 * Replay is strictly FIFO and serialized. The database's natural-key index is
 * partial on `voided_at is null`, so a sequence like record #3, void #3,
 * record #3 again is only valid in that order — replaying it out of order
 * collides. One flush runs at a time and stops at the first failure rather
 * than skipping ahead.
 */

import {
  classifyAttempt,
  backoffMs,
  dependencyGroup,
  entryKeys,
  ownership,
  safeResolutions,
} from "./queue-recovery";

const DB_NAME = "season-tempo-qab";
// v2 (ST-022) adds the "discarded" store: a write removed from the queue —
// by a provably safe resolution or by the coach — is kept here, never just
// deleted, so what was set aside can still be found.
const DB_VERSION = 2;
const STORE = "queue";
const DISCARDED = "discarded";

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true });
        store.createIndex("gameId", "gameId");
      }
      if (!db.objectStoreNames.contains(DISCARDED)) {
        db.createObjectStore(DISCARDED, { keyPath: "seq" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    // A blocked or unavailable IndexedDB must not break tracking. The caller
    // falls back to sending directly and surfaces sync state honestly.
    req.onerror = () => resolve(null);
  });

  return dbPromise;
}

function tx(db, mode, fn, storeName = STORE) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.value ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/**
 * Queue one write. Returns true when it is durably stored.
 *
 * `entry.userId` is the signed-in user who made it (ST-022). A write is only
 * ever replayed for that same user; another account signed in on the same
 * browser never sends it.
 */
export async function enqueue(entry) {
  const db = await openDb();
  if (!db) return false;
  await tx(db, "readwrite", (s) =>
    s.add({ ...entry, queuedAt: Date.now(), attempts: 0, lastError: null, state: "pending" })
  );
  return true;
}

/** Everything still waiting, oldest first. */
export async function pendingEntries(gameId) {
  const db = await openDb();
  if (!db) return [];
  const rows = await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
  return rows
    .filter((r) => !gameId || r.gameId === gameId)
    .sort((a, b) => a.seq - b.seq);
}

async function remove(seq) {
  const db = await openDb();
  if (!db) return;
  await tx(db, "readwrite", (s) => s.delete(seq));
}

async function getEntry(seq) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).get(seq);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

async function patch(seq, fields) {
  const db = await openDb();
  if (!db) return;
  const row = await getEntry(seq);
  if (!row) return;
  await tx(db, "readwrite", (s) => s.put({ ...row, ...fields }));
}

/**
 * Moves writes out of the queue into the discarded log, with the reason.
 * Used for provably safe resolutions and for a coach's explicit choice.
 */
export async function discardEntries(seqs, reason) {
  const db = await openDb();
  if (!db) return;
  for (const seq of seqs) {
    const row = await getEntry(seq);
    if (!row) continue;
    await tx(db, "readwrite", (s) => s.put({ ...row, discardedAt: Date.now(), discardReason: reason }), DISCARDED);
    await tx(db, "readwrite", (s) => s.delete(seq));
  }
}

/** Puts a write in front of the coach. It is never retried automatically again. */
async function markReview(seq, { code, error, conflict = null }) {
  await patch(seq, { state: "review", code, lastError: error ?? null, conflict, nextAttemptAt: null });
}

let flushing = false;

/**
 * Sends queued writes (ST-022 rules).
 *
 * 1. Provably safe resolutions first — a never-sent record cancelled by its
 *    own void, or a record whose slot already holds the identical at-bat.
 *    Nothing is sent and no QAB data changes; the writes move to the
 *    discarded log.
 * 2. Writes are considered oldest first. A write is sent only if it belongs
 *    to the signed-in user. A write by another user, a write from before
 *    identities were stored, or a write awaiting review is not sent — and
 *    neither is anything queued after it that depends on it (same plate
 *    appearance or slot). Unrelated writes continue.
 * 3. A permanent rejection becomes "review": it stops retrying and blocks
 *    only its own dependents. A transient failure (offline, timeout, sign-in)
 *    stops the pass and retries later with backoff, because order matters
 *    across a reconnect.
 *
 * `send` resolves to a server action result; it throws when the request
 * itself fails. `force` (the Retry button) ignores the backoff wait.
 */
export async function flushQueue(send, { gameId, userId, savedRows = [], force = false } = {}) {
  if (flushing) return { skipped: true };
  flushing = true;
  try {
    let entries = await pendingEntries(gameId);

    for (const r of safeResolutions(entries, savedRows)) {
      await discardEntries(r.seqs, r.reason);
    }
    entries = await pendingEntries(gameId);

    const blocked = new Set();
    const block = (e) => entryKeys(e).forEach((k) => blocked.add(k));
    const isBlocked = (e) => entryKeys(e).some((k) => blocked.has(k));
    let sent = 0;

    for (const entry of entries) {
      const owner = ownership(entry, userId);

      if (owner === "unknown" && entry.state !== "review") {
        // Never sent automatically: who made it cannot be known. The coach
        // decides, with the saved entry beside it where there is one.
        await markReview(entry.seq, {
          code: "unconfirmed",
          error: entry.lastError,
          conflict: entry.conflict ?? null,
        });
        entry.state = "review";
      }
      if (owner === "other" || entry.state === "review" || isBlocked(entry)) {
        block(entry);
        continue;
      }

      if (!force && entry.nextAttemptAt && Date.now() < entry.nextAttemptAt) {
        return { sent, waiting: true };
      }

      let result = null;
      let thrown = null;
      try {
        result = await send(entry);
      } catch (e) {
        thrown = e;
      }
      const outcome = classifyAttempt(result, thrown);

      if (outcome.kind === "ok") {
        await remove(entry.seq);
        sent += 1;
        continue;
      }

      if (outcome.kind === "permanent") {
        await markReview(entry.seq, {
          code: outcome.code,
          error: result?.error ?? "Rejected",
          conflict: result?.conflict ?? null,
        });
        block(entry);
        continue;
      }

      const attempts = (entry.attempts ?? 0) + 1;
      await patch(entry.seq, {
        attempts,
        lastError: thrown?.message ?? result?.error ?? "Network unavailable",
        code: outcome.code,
        nextAttemptAt: Date.now() + backoffMs(attempts),
      });
      return { sent, stoppedAt: entry.seq, error: thrown?.message ?? result?.error ?? "Network unavailable" };
    }

    return { sent, stoppedAt: null, error: null };
  } finally {
    flushing = false;
  }
}

/**
 * Counts for the sync indicator and the Finish gate.
 *   waiting — this user's writes not yet delivered (including any held behind
 *             a write awaiting review)
 *   review  — groups awaiting the coach's decision
 *   other   — writes made by a different signed-in user on this browser
 */
export async function queueStatus(gameId, userId) {
  const entries = await pendingEntries(gameId);
  const reviewHeads = entries.filter((e) => e.state === "review" && ownership(e, userId) !== "other");
  const inReview = new Set();
  for (const h of reviewHeads) for (const g of dependencyGroup(entries, h)) inReview.add(g.seq);
  const other = entries.filter((e) => ownership(e, userId) === "other");
  const waiting = entries.filter((e) => !inReview.has(e.seq) && ownership(e, userId) !== "other");
  return {
    waiting: waiting.length,
    review: reviewHeads.length,
    other: other.length,
    failed: waiting.filter((e) => (e.attempts ?? 0) > 0).length,
    firstError: waiting.find((e) => e.lastError)?.lastError ?? null,
  };
}

/**
 * Writes awaiting review, each with the writes that depend on it, oldest
 * first: [{ head, group }]. The tracker renders these.
 */
export async function reviewGroups(gameId, userId) {
  const entries = await pendingEntries(gameId);
  return entries
    .filter((e) => e.state === "review" && ownership(e, userId) !== "other")
    .map((head) => ({ head, group: dependencyGroup(entries, head) }));
}

/**
 * The coach confirms a write made before identities were stored as theirs,
 * or asks to try a rejected write again: it returns to the queue, owned by
 * the signed-in user, with its dependents.
 */
export async function adoptForRetry(seqs, userId) {
  for (const seq of seqs) {
    await patch(seq, { state: "pending", userId, attempts: 0, nextAttemptAt: null, code: null });
  }
}

/** A uuid the browser can make without a network call. */
export function newPaId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
