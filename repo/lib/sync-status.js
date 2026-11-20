/**
 * What the tracker's status line says (IMP-001, Release 3).
 *
 * Pure: no IndexedDB, no React. One definition of every state so the wording
 * and the rules for "All saved" live in one tested place.
 *
 * The rule that matters most: "All saved" is claimed ONLY when
 *   - the queue has been read successfully at least once,
 *   - nothing is waiting, held, or in review,
 *   - nothing is being sent right now, and
 *   - the phone is online.
 * A queue that could not be read is never treated as an empty queue.
 *
 * `status` is queueStatus(): { readable, waiting, review, other, failed, firstError }.
 * `checked` is true once a read has succeeded; `flushingCount` is how many
 * at-bats the current send pass is working on (0 when idle).
 */

const bats = (n) => `${n} at-${n === 1 ? "bat" : "bats"}`;

export const ALL_SAVED = { tone: "ok", text: "All saved" };

export function syncDisplay({ checked = false, status = null, flushingCount = 0, online = true } = {}) {
  // Not read yet, or the read failed: never "All saved".
  if (!checked || !status || status.readable === false) {
    if (status && status.readable === false) {
      return {
        tone: "bad",
        text: "Can't check what is saved on this phone",
        detail: "Your at-bats are not lost, but this can't be confirmed right now.",
        retry: true,
      };
    }
    return { tone: "wait", text: "Checking saved at-bats..." };
  }

  // Needs the coach: always visible, even while other writes are sending.
  if (status.review > 0) {
    return { tone: "bad", text: `${bats(status.review)} ${status.review === 1 ? "needs" : "need"} your review` };
  }

  const nothingMine = status.waiting === 0;
  if (nothingMine && status.other === 0) {
    if (flushingCount > 0) return { tone: "wait", text: `Syncing ${bats(flushingCount)}...` };
    return online ? ALL_SAVED : {
      tone: "wait",
      text: "Offline. At-bats you record are kept on this phone and sync when you reconnect.",
    };
  }
  if (nothingMine) {
    return { tone: "wait", text: `${bats(status.other)} from another account on this device` };
  }

  if (status.failed > 0 && flushingCount === 0) {
    return {
      tone: "bad",
      text: `Sync failed. ${status.waiting} waiting`,
      detail: status.firstError,
      retry: true,
    };
  }

  if (flushingCount > 0 && online) return { tone: "wait", text: `Syncing ${bats(Math.max(flushingCount, 1))}...` };
  return { tone: "wait", text: online ? `${status.waiting} waiting to sync` : `${status.waiting} waiting to sync (offline)` };
}

/** Why the status line is in a state that stops Finish (kept next to the wording). */
export function blocksFinish(status) {
  return !status || status.readable === false || status.review > 0 || status.waiting > 0 || status.other > 0;
}
