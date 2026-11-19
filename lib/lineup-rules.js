import { resumePosition } from "./tracker-cursor";

/**
 * When a late arrival enters the batting sequence.
 *
 * Once a game has recorded at-bats the order is fixed, and a late arrival is
 * added as a NEW LAST slot. The tracker walks the slots in order and wraps to
 * slot 1, so a new last slot bats right after the current last slot, in
 * whichever pass the game is in. Nothing before it moves.
 *
 *   last at-bat was slot L, the order has N slots
 *   batters who bat before the new slot = N - L
 *   0 means the new batter is next (the last at-bat was in slot N)
 *
 * Works the same before the order has wrapped (L=4 of 9 -> 5 batters first) and
 * after it has (second time through, L=2 of 9 -> 7 batters first). The late
 * batter never gets back the turns already taken: their first at-bat is the
 * first time the sequence reaches their slot.
 *
 * The answer is derived with the same cursor the tracker uses, so what the
 * lineup screen says and what the tracker does cannot disagree. If the cursor
 * cannot be derived (tied timestamps, an at-bat that fits no slot) the result
 * is ambiguous and the caller words it generally rather than guessing.
 *
 * Pure: no React, no database.
 *
 * @param order  saved slots, ascending, each { batting_order }
 * @param rows   plate appearances for the game, voided ones included
 */
export function lateArrivalTiming(order = [], rows = []) {
  const n = (order ?? []).length;
  const cur = resumePosition(order, rows);
  const active = (rows ?? []).filter((r) => !r.voided_at);

  if (n === 0 || active.length === 0) {
    return { tracked: false, ambiguous: false, n, newSlot: n + 1 };
  }
  if (cur.ambiguous) {
    return { tracked: true, ambiguous: true, n, newSlot: n + 1, reason: cur.reason };
  }

  // index is the slot due next (0-based); index 0 after a wrap means slot N
  // was the last to bat.
  const lastSlot = cur.index === 0 ? n : cur.index;
  const ahead = n - lastSlot;

  const perSlot = new Map();
  for (const r of active) perSlot.set(r.batting_order, (perSlot.get(r.batting_order) ?? 0) + 1);
  const secondPassOrLater = [...perSlot.values()].some((c) => c >= 2);

  return {
    tracked: true,
    ambiguous: false,
    n,
    newSlot: n + 1,
    lastSlot,
    ahead,
    next: ahead === 0,
    firstAheadSlot: ahead > 0 ? lastSlot + 1 : null,
    secondPassOrLater,
  };
}

/** Plain-English explanation shown with late arrivals. */
export function lateArrivalMessage(timing, addedCount = 1) {
  if (!timing?.tracked) return null;
  const many = addedCount > 1;
  const who = many ? "The first late batter" : "A late batter";
  const tail = many ? " The others follow in the order added." : "";
  const noMakeup = " Late batters do not get the turns already taken.";
  if (timing.ambiguous) {
    return `${who} joins at the end of the order, in slot ${timing.newSlot}, and bats after the batter in slot ${timing.n}.${tail}${noMakeup}`;
  }
  if (timing.next) {
    return `${who} joins at the end of the order, in slot ${timing.newSlot}, and bats next, right after the batter who just hit (slot ${timing.lastSlot}).${tail}${noMakeup}`;
  }
  const first = timing.firstAheadSlot;
  const slots = first === timing.n ? `slot ${timing.n}` : `slots ${first} to ${timing.n}`;
  const count = timing.ahead === 1 ? "1 batter" : `${timing.ahead} batters`;
  return `${who} joins at the end of the order, in slot ${timing.newSlot}. ${count} (${slots}) bat before them, so their first at-bat comes after slot ${timing.n}.${tail}${noMakeup}`;
}
