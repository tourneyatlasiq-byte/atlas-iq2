/**
 * Rebuilding the tracker's list from the server's rows plus what is still
 * waiting on this phone (2026-11-20).
 *
 * The page the tracker opens with is a snapshot of what the SERVER holds. At-bats
 * recorded on this phone and not yet synced are only in the device queue, so a
 * coach who left the tracker and came back saw an older list: the wrong batter,
 * old totals, and, once the queue sent them, "All saved" over a list that was
 * missing them. This module is the one place that merges the two and works out
 * who is up, so the tracker can show a correct, ready-to-record state before it
 * accepts a tap.
 *
 * Pure: no React, no IndexedDB, no clock. Reuses the queue's own rules
 * (ownership, dependency groups, slot keys) and the cursor's own rule for
 * "who is next", so nothing here is a second definition of either.
 */
import { dependencyGroup, ownership, savedInSlot } from "./queue-recovery.js";
import { resumePosition } from "./tracker-cursor.js";

const sameSlot = (a, b) => a.player_id === b.player_id && a.pa_number === b.pa_number;

/** Writes that belong in this coach's view: theirs, not awaiting review, not behind one that is. */
function applicable(entries, userId) {
  const sorted = [...(entries ?? [])].sort((a, b) => a.seq - b.seq);
  const held = new Set();
  for (const e of sorted) {
    if (e.state !== "review" || ownership(e, userId) === "other") continue;
    for (const g of dependencyGroup(sorted, e)) held.add(g.seq);
  }
  return sorted.filter((e) => ownership(e, userId) === "mine" && !held.has(e.seq));
}

/**
 * @param lineup    the batting order on screen ([{ player_id, batting_order }])
 * @param savedRows plate appearances as the server reported them
 * @param entries   this game's queued writes (offline-queue pendingEntries)
 * @param userId    the signed-in user
 * @returns { rows, applied, cursor }  cursor is { index, ambiguous, reason }
 */
export function restoreFromQueue({ lineup = [], savedRows = [], entries = [], userId = null } = {}) {
  const rows = savedRows.map((r) => ({ ...r }));
  const pendingIds = [];
  let applied = 0;
  const maxLocal = savedRows.reduce((m, r) => Math.max(m, r.localSeq ?? 0), 0);
  let tick = 0;

  for (const e of applicable(entries, userId)) {
    const p = e.payload ?? {};
    if (e.op === "record") {
      if (!p.id || rows.some((r) => r.id === p.id)) continue;
      const candidate = { player_id: p.playerId, pa_number: p.paNumber };
      // A different at-bat already holds this slot: a conflict for the coach to
      // decide in review, never a second row in the list.
      if (rows.some((r) => !r.voided_at && sameSlot(r, candidate))) continue;
      const reasons = p.reasons ?? [];
      rows.push({
        id: p.id,
        player_id: p.playerId,
        pa_number: p.paNumber,
        batting_order: p.battingOrder ?? null,
        qab_reasons: reasons,
        is_qab: reasons.length > 0,
        notes: p.notes ?? null,
        voided_at: null,
        localSeq: Math.max(maxLocal, e.queuedAt ?? 0) + (tick += 1),
        pending: true,
      });
      pendingIds.push(p.id);
      applied += 1;
    } else if (e.op === "void") {
      const row = rows.find((r) => r.id === p.id);
      if (row && !row.voided_at) {
        row.voided_at = new Date(e.queuedAt ?? 0).toISOString();
        applied += 1;
      }
    } else if (e.op === "correct") {
      const row = rows.find((r) => r.id === p.id);
      if (row) {
        row.qab_reasons = p.reasons ?? row.qab_reasons;
        row.is_qab = (row.qab_reasons ?? []).length > 0;
        if (Object.prototype.hasOwnProperty.call(p, "notes")) row.notes = p.notes ?? null;
        applied += 1;
      }
    }
  }

  // Who is up. With at-bats still on the phone the last of them decides, in
  // the order they were tapped; otherwise the saved sequence does, exactly as
  // it did when the page opened.
  const lastPending = [...pendingIds].reverse().map((id) => rows.find((r) => r.id === id)).find((r) => r && !r.voided_at);
  let cursor;
  if (!lastPending) {
    cursor = resumePosition(lineup, rows);
  } else {
    const idx = lineup.findIndex((s) => s.batting_order === lastPending.batting_order);
    cursor = lastPending.batting_order == null || idx < 0
      ? { index: 0, ambiguous: true, reason: "unplaceable-last-pa" }
      : { index: (idx + 1) % lineup.length, ambiguous: false, reason: "derived" };
  }
  return { rows, applied, cursor };
}

/**
 * Review groups whose first write is a record that a saved at-bat already
 * answers for. The unsynced twin must not count beside the saved one while the
 * coach decides, so it is left out of the list and the totals.
 */
export function hideConflictedPending(rows, reviewGroups = []) {
  const savedRows = rows.filter((r) => !r.pending);
  const hide = new Set();
  const twins = [];
  for (const g of reviewGroups) {
    const head = g?.head;
    if (head?.op !== "record") continue;
    if (!head.conflict && !savedInSlot(head, savedRows)) continue;
    for (const e of g.group ?? [head]) if (e.op === "record" && e.payload?.id) hide.add(e.payload.id);
    // The saved at-bat the server reported counts once, even when this phone
    // never had it in its list.
    const c = head.conflict;
    if (c?.id && !rows.some((r) => r.id === c.id) && !twins.some((t) => t.id === c.id)) {
      const p = head.payload ?? {};
      twins.push({
        id: c.id, player_id: p.playerId, pa_number: p.paNumber, batting_order: p.battingOrder ?? null,
        qab_reasons: c.reasons ?? [], is_qab: (c.reasons ?? []).length > 0, notes: c.notes ?? null, voided_at: null, localSeq: 0,
      });
    }
  }
  if (hide.size === 0) return rows;
  return [...rows.filter((r) => !(r.pending && hide.has(r.id))), ...twins];
}

/**
 * The list after the coach settles a review group.
 *   keep "saved"    - what the server holds stands. Unsynced at-bats leave the
 *                     list; a rejected correction or void shows its last saved value.
 *   keep "unsynced" - the saved at-bat takes the unsynced reason and note; no
 *                     second at-bat is ever left in the slot.
 * `baseline` is the last rows the server reported, used to put values back.
 */
export function settleGroup(rows, group, { keep, baseline = [], savedId = null, reasons = null, notes = null } = {}) {
  let out = rows.map((r) => ({ ...r }));
  const entries = group?.group ?? (group?.head ? [group.head] : []);
  const recordIds = new Set(entries.filter((e) => e.op === "record").map((e) => e.payload?.id).filter(Boolean));
  out = out.filter((r) => !(r.pending && recordIds.has(r.id)));

  const conflict = group?.head?.conflict ?? null;
  const p = group?.head?.payload ?? {};
  const twinId = savedId ?? conflict?.id ?? null;
  if (twinId && !out.some((r) => r.id === twinId) && group?.head?.op === "record") {
    const from = keep === "unsynced" ? { reasons: reasons ?? [], notes } : { reasons: conflict?.reasons ?? [], notes: conflict?.notes ?? null };
    out.push({
      id: twinId, player_id: p.playerId, pa_number: p.paNumber, batting_order: p.battingOrder ?? null,
      qab_reasons: from.reasons, is_qab: from.reasons.length > 0, notes: from.notes ?? null,
      voided_at: null, localSeq: 0,
    });
  }

  if (keep === "unsynced" && twinId) {
    out = out.map((r) => (r.id === twinId ? { ...r, qab_reasons: reasons ?? [], is_qab: (reasons ?? []).length > 0, notes } : r));
  }
  if (keep === "saved") {
    for (const e of entries) {
      if (e.op === "record") continue;
      const id = e.payload?.id;
      const was = baseline.find((b) => b.id === id);
      if (!was) continue;
      out = out.map((r) => (r.id === id ? { ...r, qab_reasons: was.qab_reasons, is_qab: was.is_qab, notes: was.notes ?? null, voided_at: was.voided_at ?? null } : r));
    }
  }
  return out;
}
