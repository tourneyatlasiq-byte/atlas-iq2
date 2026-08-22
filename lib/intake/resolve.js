/**
 * Conflict and diff resolution.
 *
 * One rule governs everything: A BLANK IMPORTED CELL IS NOT AN INSTRUCTION.
 * It means the source did not collect that field, never that the existing
 * value should be cleared.
 */

import { BY_KEY } from "./registry.js";

export const DIFF = {
  FILL: "fill",       // existing blank, import has a value  -> propose
  SAME: "same",       // identical                            -> no action
  CONFLICT: "conflict", // both populated and different       -> coach decides
  KEEP: "keep",       // import blank                         -> keep existing
};

const isBlank = (v) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Compare in the shape the field is stored in, not as raw text. */
function equal(type, a, b) {
  if (type === "list") {
    const x = [...(a ?? [])].sort().join("|");
    const y = [...(b ?? [])].sort().join("|");
    return x === y;
  }
  if (type === "int") return Number(a) === Number(b);
  if (type === "email" || type === "text" || type === "enum") {
    return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  }
  return String(a ?? "") === String(b ?? "");
}

/**
 * Diff one incoming record against what exists.
 *
 * Returns an entry per field the import actually carried, so a coach sees only
 * what the file had an opinion about.
 */
export function diffRecord(incoming = {}, existing = {}) {
  const entries = [];

  for (const [key, value] of Object.entries(incoming)) {
    const field = BY_KEY.get(key);
    if (!field || !field.importable || !field.destination) continue;

    const current = existing[key];
    const inBlank = isBlank(value);
    const exBlank = isBlank(current);

    if (inBlank) {
      // Never an erase. Not even reported as a change.
      entries.push({ key, label: field.label, status: DIFF.KEEP, existing: current, incoming: null });
      continue;
    }
    if (exBlank) {
      entries.push({ key, label: field.label, status: DIFF.FILL, existing: null, incoming: value,
                     sensitive: field.sensitive, pendingMigration: field.pendingMigration });
      continue;
    }
    if (equal(field.type, value, current)) {
      entries.push({ key, label: field.label, status: DIFF.SAME, existing: current, incoming: value });
      continue;
    }
    entries.push({ key, label: field.label, status: DIFF.CONFLICT, existing: current, incoming: value,
                   sensitive: field.sensitive, pendingMigration: field.pendingMigration });
  }

  return {
    entries,
    fills: entries.filter((e) => e.status === DIFF.FILL),
    conflicts: entries.filter((e) => e.status === DIFF.CONFLICT),
    unchanged: entries.filter((e) => e.status === DIFF.SAME || e.status === DIFF.KEEP),
  };
}

/**
 * The values a plan may carry: fills always, conflicts only where the coach
 * explicitly chose the imported value.
 *
 * `decisions` is { [key]: "existing" | "incoming" }. An undecided conflict
 * contributes nothing, which is what keeps a Conflict row non-executable.
 */
export function applyDecisions(diff, decisions = {}) {
  const out = {};
  const undecided = [];

  for (const e of diff.fills) out[e.key] = e.incoming;

  for (const e of diff.conflicts) {
    const choice = decisions[e.key];
    if (choice === "incoming") out[e.key] = e.incoming;
    else if (choice !== "existing") undecided.push(e.key);
  }

  return { values: out, undecided };
}
