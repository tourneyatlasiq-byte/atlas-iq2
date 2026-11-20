/**
 * How loudly the picker offers "add new" (2026-11).
 *
 * A bright "Add 'riv' as new" button next to matching places invites a
 * duplicate. The rule: while there is an existing record the coach could pick,
 * adding stays available but quiet. It becomes the bright main action only
 * when nothing can be picked: something is typed and nothing matches, or the
 * directory is empty.
 *
 * `forceQuiet` is for a button that is not "create" at all (such as "Not
 * linked"), which must never be the loudest thing on the sheet.
 */
export function createEmphasis({ query = "", matchCount = 0, itemCount = 0, forceQuiet = false } = {}) {
  if (forceQuiet) return "quiet";
  if (itemCount === 0) return "primary";
  return query.trim() && matchCount === 0 ? "primary" : "quiet";
}
