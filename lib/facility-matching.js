/**
 * Facility matching primitives.
 *
 * Extracted verbatim from lib/facility-import.js so the import ladder and the
 * Add Facility form use one implementation instead of three. Before this module
 * there were three copies of normalizeName — here, in lib/queries/facilities.js
 * and inline in FacilitiesClient.js — and only the import copy had the token
 * and address rules that catch real duplicates.
 *
 * Pure by design: no server imports, so client components can use it. That is
 * why it cannot live in lib/queries/facilities.js, which pulls in next/headers
 * through the Supabase server client and breaks the build when imported from a
 * client component.
 *
 * Behaviour is unchanged from the import implementation. Nothing here does
 * coordinate matching.
 */

/** Normalized the same way as the generated name_normalized column. */
export function normalizeName(name) {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Word tokens for near-duplicate detection.
 *
 * Substring matching is not enough: "Al Bishop Complex" is not a substring of
 * "Al Bishop Softball Complex" because of the inserted word, and the same
 * happens with "Heritage Point Park" vs "Heritage Point Regional Park". Both
 * are real duplicates in the Georgia batch. Comparing word sets catches them.
 */
export function nameTokens(name) {
  return new Set(
    (name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
  );
}

/** True when one name's words are wholly contained in the other's. */
export function tokensOverlap(a, b) {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (A.size === 0 || B.size === 0) return false;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

/** Street addresses, normalized past the usual Drive/Dr, Road/Rd variation. */
export function normalizeAddress(addr) {
  if (!addr) return null;
  const n = addr
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(highway|hwy)\b/g, "hwy")
    .replace(/\b(parkway|pkwy)\b/g, "pkwy")
    .replace(/\b(north|n)\b/g, "n")
    .replace(/\b(south|s)\b/g, "s")
    .replace(/\b(east|e)\b/g, "e")
    .replace(/\b(west|w)\b/g, "w")
    .replace(/\s+/g, " ")
    .trim();
  return n === "" ? null : n;
}

/** Case- and whitespace-insensitive equality, as used by the import matcher. */
const eq = (a, b) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Candidate duplicates for a facility being created, in the same order and by
 * the same rules the import matcher applies.
 *
 * Returns matches with the rule that fired, so the caller decides what to do.
 * This function never blocks, never merges and never writes — the import action
 * and the Add Facility form each apply their own policy to the result.
 *
 * Rules, in precedence order:
 *
 *   exact_name_locality  same city + state, identical normalized name
 *   same_address         same city + state, identical normalized street address
 *   token_subset         same city + state, one name's words inside the other's
 *   cross_city_name      same state, identical normalized name, different city
 *
 * cross_city_name is deliberately separated: two towns in one state can each
 * have a "Riverside Park", so it is information, never evidence of a duplicate.
 */
export function findCatalogDuplicates(facilities, candidate, { excludeId = null } = {}) {
  const norm = normalizeName(candidate?.name);
  if (!norm) return [];

  const candAddress = normalizeAddress(candidate?.street_address);
  const out = [];

  for (const f of facilities ?? []) {
    if (excludeId && f.id === excludeId) continue;

    const sameState = eq(f.state, candidate?.state);
    const sameLocality = sameState && eq(f.city, candidate?.city);
    const fNorm = f.name_normalized ?? normalizeName(f.name);

    if (sameLocality && fNorm === norm) {
      out.push({ facility: f, rule: "exact_name_locality" });
      continue;
    }
    if (sameLocality && candAddress && normalizeAddress(f.street_address) === candAddress) {
      out.push({ facility: f, rule: "same_address" });
      continue;
    }
    if (sameLocality && tokensOverlap(f.name, candidate?.name)) {
      out.push({ facility: f, rule: "token_subset" });
      continue;
    }
    if (sameState && fNorm === norm) {
      out.push({ facility: f, rule: "cross_city_name" });
    }
  }

  return out;
}

/** Rules that indicate a probable duplicate, as opposed to a note. */
export const DUPLICATE_RULES = ["exact_name_locality", "same_address", "token_subset"];
