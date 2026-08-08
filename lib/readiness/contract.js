/**
 * Needs Action — the shared Atlas IQ pattern.
 *
 * "These are the things that currently require the user's attention."
 *
 * An action is derived from records already on screen. Nothing is stored, so
 * a rule change is a code change with no migration and no status to drift.
 *
 * Contract:
 *   id        stable key, used to drive filtering
 *   title     what needs doing        e.g. "Uniform information"
 *   detail    the specifics           e.g. "4 players need sizes"
 *   affected  the records themselves, not just a count — this is what makes
 *             click-to-filter free rather than a second query
 *   priority  fixed ordering; lower sorts first. Deliberately NOT count-driven,
 *             so the list doesn't reshuffle as items are resolved.
 *   dueDate   optional ISO date. Unused in MVP but part of the contract now,
 *             so configurable deadlines later are a value change, not a
 *             restructure.
 *
 * Rules live in one place per module (lib/readiness/*.js) and are imported by
 * both the page and its client component. They must never be duplicated across
 * server and client code.
 */

/** Builds an action, or null when nothing is affected. Null entries are dropped. */
export function action({ id, title, detail, affected, priority = 100, dueDate = null }) {
  if (!affected || affected.length === 0) return null;
  return { id, title, detail, affected, priority, dueDate };
}

/** Drops empty checks and applies the fixed priority order. */
export function collect(candidates) {
  return candidates
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
}

/** "1 player" / "4 players" — avoids "1 players" showing up in details. */
export function count(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The ids an action affects, for filtering a list by that action. */
export function affectedIds(action, key = "id") {
  return new Set((action?.affected ?? []).map((r) => r[key]));
}
