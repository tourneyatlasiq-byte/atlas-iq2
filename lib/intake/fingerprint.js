/**
 * The idempotency fingerprint for one approved import.
 *
 * ONE IMPLEMENTATION, in the trusted server layer. Not in the browser, where a
 * tampered client could choose what it hashes, and not in PL/pgSQL, where a
 * second implementation would drift from this one the first time either
 * changed. lib/actions/intake.js is the only caller.
 *
 * WHAT IT PROVES. The fingerprint does not identify an import — run_key does
 * that. Its single job is to prove that a run_key is still attached to the
 * content the coach approved. Same key with a different fingerprint means the
 * plan changed underneath the key, and that must fail rather than return the
 * earlier result.
 *
 * WHY NOT JSON.stringify. Object key order in JavaScript is an accident of
 * insertion, so two payloads that are identical in meaning can serialise
 * differently and hash differently — a coach would be told their unchanged
 * import had changed. canonical() establishes the ordering deliberately
 * instead of hoping the accident is stable.
 *
 * ARRAY ORDER IS PRESERVED. Rows execute in order and contacts within a row
 * carry sort_order, so reordering them is a genuinely different import.
 * Objects are sorted; arrays never are.
 */

import { createHash } from "crypto";

/**
 * A deterministic string for any JSON-compatible value.
 *
 * Keys are emitted in sorted order rather than insertion order. The sort is
 * explicit and does not rely on how the engine happens to enumerate
 * properties — integer-like keys, for instance, are enumerated numerically
 * before string keys regardless of when they were added.
 *
 * undefined-valued keys are omitted, matching JSON semantics, so an absent key
 * and a key set to undefined hash the same. An explicit null does NOT: null is
 * a value the payload can carry meaningfully.
 */
export function canonical(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonical(v))).join(",")}]`;
  }
  if (typeof value === "object") {
    const parts = [];
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonical(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Cannot fingerprint a non-finite number.");
  }
  return JSON.stringify(value);
}

/**
 * SHA-256, lowercase hex, of the canonical form of the whole approved
 * operation.
 *
 * Scope is inside the hash, not merely alongside it: the same rows approved
 * for a different team or season are a different import, and hashing the
 * scope means a key cannot be replayed across one.
 */
export function fingerprintImport({ organizationId, teamId, seasonId, rows }) {
  const doc = canonical({
    organization_id: organizationId ?? null,
    team_id: teamId ?? null,
    season_id: seasonId ?? null,
    rows: rows ?? [],
  });
  return createHash("sha256").update(doc, "utf8").digest("hex");
}
