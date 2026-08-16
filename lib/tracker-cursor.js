/**
 * Where the batting order resumes when the tracker is opened.
 *
 * The tracker used to initialise its cursor to 0 on every mount, so reopening
 * a partially tracked game silently restarted at the top of the order. A coach
 * would tap through and re-bat the front of the lineup: in one real game the
 * leadoff batter reached PA 3 while ten players were still on PA 1.
 *
 * Derived from the actual EVENT SEQUENCE, never from per-player or per-slot
 * PA counts. Counts cannot distinguish a healthy game from a corrupted one —
 * the game above has entirely plausible-looking counts. Only the order in
 * which plate appearances were recorded says who batted last.
 *
 * Position, not player. A substitution replaces the occupant of a batting
 * slot, so resuming by slot means completing slot 4 advances to whoever holds
 * slot 5 now — the substitute, not the player who started there.
 *
 * Pure: no React, no database, no clock. Everything it needs is passed in,
 * which is what makes the ten regression cases in scripts/check-cursor.js
 * runnable in plain node.
 */

/**
 * Orders plate appearances as they were recorded.
 *
 * created_at is assigned by the database at INSERT, not by the client, so an
 * at-bat recorded offline carries the timestamp of its sync rather than of the
 * tap. The offline queue is keyed by an autoincrementing `seq` and flushed
 * strictly in order, stopping at the first failure, so relative order survives
 * a replay even though the absolute times compress. There is no monotonic
 * per-game sequence column; batting_order is the tiebreaker for rows that land
 * in the same millisecond.
 */
function bySequence(a, b) {
  const at = a.created_at ?? "";
  const bt = b.created_at ?? "";
  if (at !== bt) return at < bt ? -1 : 1;
  return (a.batting_order ?? 0) - (b.batting_order ?? 0);
}

/**
 * @param order  lineup slots, ascending, each { batting_order }
 * @param rows   plate appearances for this game, voided ones included
 * @returns { index, ambiguous, reason }
 *          index is a position in `order`; ambiguous means the caller must ask
 *          the coach rather than guess.
 */
export function resumePosition(order = [], rows = []) {
  if (!order || order.length === 0) {
    return { index: 0, ambiguous: false, reason: "no-lineup" };
  }

  // Voided plate appearances are not events. Undoing the last at-bat must
  // hand the slot back, not push the order forward past it.
  const active = (rows ?? []).filter((r) => !r.voided_at);

  // A fresh game starts at the top. This is the only case where position 1 is
  // chosen by default rather than derived.
  if (active.length === 0) {
    return { index: 0, ambiguous: false, reason: "fresh-game" };
  }

  const sorted = [...active].sort(bySequence);
  const last = sorted[sorted.length - 1];

  // Two at-bats sharing the last timestamp in different slots leave no
  // defensible "most recent". Rare, but guessing here would reintroduce
  // exactly the silent-wrong-answer failure this function exists to remove.
  const tied = sorted.filter(
    (r) => (r.created_at ?? "") === (last.created_at ?? "") &&
           r.batting_order !== last.batting_order
  );
  if (tied.length > 0) {
    return { index: 0, ambiguous: true, reason: "tied-timestamps" };
  }

  // The slot the last at-bat was recorded against must still exist in the
  // order. If it does not — a slot was removed, or the at-bat was stored
  // without a position — the next position cannot be derived.
  const idx = order.findIndex((s) => s.batting_order === last.batting_order);
  if (last.batting_order == null || idx < 0) {
    return { index: 0, ambiguous: true, reason: "unplaceable-last-pa" };
  }

  // Cyclical: after the final position, wrap to the first.
  return { index: (idx + 1) % order.length, ambiguous: false, reason: "derived" };
}

/**
 * Read-only integrity check, for auditing rather than for driving the cursor.
 *
 * Walks the at-bats in the order they were recorded and checks each one
 * against the position the cycle says should have batted next.
 *
 * Deliberately NOT count-based. A count check compares how many at-bats each
 * slot has taken, and the production failure produced counts that look
 * entirely normal: the leadoff batter had two while everyone else had one,
 * a spread of one, which is ordinary mid-cycle. Only replaying the sequence
 * exposes that her second at-bat came before anyone else's first.
 *
 * After a violation the expectation resynchronises to the slot that actually
 * batted, so one anomaly reports once instead of cascading through the rest
 * of the game. Reports, never repairs.
 */
export function sequenceAudit(order = [], rows = []) {
  const active = (rows ?? []).filter((r) => !r.voided_at).sort(bySequence);
  const slots = (order ?? []).map((s) => s.batting_order);

  if (slots.length === 0) {
    return { activePas: active.length, violations: [], unplaceable: active.length, impossible: false };
  }

  const violations = [];
  let unplaceable = 0;
  let expected = 0;

  for (const [i, r] of active.entries()) {
    const at = slots.indexOf(r.batting_order);
    if (r.batting_order == null || at < 0) {
      unplaceable += 1;
      continue;
    }
    if (at !== expected) {
      violations.push({
        sequence: i + 1,
        expectedSlot: slots[expected],
        actualSlot: r.batting_order,
        paNumber: r.pa_number ?? null,
      });
    }
    expected = (at + 1) % slots.length;
  }

  return {
    activePas: active.length,
    unplaceable,
    violations,
    impossible: violations.length > 0,
  };
}
