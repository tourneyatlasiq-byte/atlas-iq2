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

const DB_NAME = "season-tempo-qab";
const DB_VERSION = 1;
const STORE = "queue";

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
    };
    req.onsuccess = () => resolve(req.result);
    // A blocked or unavailable IndexedDB must not break tracking. The caller
    // falls back to sending directly and surfaces sync state honestly.
    req.onerror = () => resolve(null);
  });

  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.value ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Queue one write. Returns true when it is durably stored. */
export async function enqueue(entry) {
  const db = await openDb();
  if (!db) return false;
  await tx(db, "readwrite", (s) =>
    s.add({ ...entry, queuedAt: Date.now(), attempts: 0, lastError: null })
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

async function markFailed(seq, message) {
  const db = await openDb();
  if (!db) return;
  const row = await new Promise((resolve) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).get(seq);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (!row) return;
  await tx(db, "readwrite", (s) =>
    s.put({ ...row, attempts: (row.attempts ?? 0) + 1, lastError: message })
  );
}

let flushing = false;

/**
 * Sends queued writes in order.
 *
 * `send` receives one entry and resolves to the action result. A result with
 * ok true — including a duplicate, which is what a successful retry looks like
 * — removes the entry. Anything else leaves it queued, records the reason, and
 * stops the flush: later entries may depend on this one having landed.
 *
 * A permanently rejected write is kept, not dropped. It shows in the failed
 * state so the person can see it rather than losing an at-bat silently.
 */
export async function flushQueue(send, { gameId } = {}) {
  if (flushing) return { skipped: true };
  flushing = true;
  try {
    const entries = await pendingEntries(gameId);
    let sent = 0;

    for (const entry of entries) {
      let result;
      try {
        result = await send(entry);
      } catch (e) {
        await markFailed(entry.seq, e?.message ?? "Network unavailable");
        return { sent, stoppedAt: entry.seq, error: e?.message ?? "Network unavailable" };
      }

      if (result?.ok) {
        await remove(entry.seq);
        sent += 1;
        continue;
      }

      await markFailed(entry.seq, result?.error ?? "Rejected");
      return { sent, stoppedAt: entry.seq, error: result?.error ?? "Rejected" };
    }

    return { sent, stoppedAt: null, error: null };
  } finally {
    flushing = false;
  }
}

/** Counts for the sync indicator. */
export async function queueStatus(gameId) {
  const entries = await pendingEntries(gameId);
  return {
    waiting: entries.length,
    failed: entries.filter((e) => (e.attempts ?? 0) > 0).length,
    firstError: entries.find((e) => e.lastError)?.lastError ?? null,
  };
}

/** A uuid the browser can make without a network call. */
export function newPaId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
