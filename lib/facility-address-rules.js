/**
 * Facility address validation rules.
 *
 * Pure and server-free: no fetch, no Supabase, no React. The decision is
 * separated from the Geocodio call so it can be tested against every case the
 * production dry run produced without a network or a browser.
 *
 * WHAT THE DRY RUN PROVED, and why these rules look the way they do:
 *
 *   `accuracy` is unusable as a gate. Geocodio returned accuracy 1 for four
 *   different precision levels — a rooftop hit, an interpolated house number,
 *   a street with no house number, and an entire town. Champions Park scored 1
 *   for returning the town of Newberry; Al Bishop, a correct address, scored
 *   0.93. `accuracy_type` decides; `accuracy` is shown to the coach as
 *   context and never compared to a threshold.
 *
 *   Rank is not quality. Al Bishop's top result was a 0.93 interpolation while
 *   a 0.90 ROOFTOP sat second. Taking results[0] would take the estimate over
 *   the surveyed point, so candidates are scanned and a consistent rooftop is
 *   preferred regardless of rank or score.
 */

/** Only a rooftop result can complete an address without a coach confirming. */
const AUTO_TYPE = "rooftop";

/** Types that can never describe a facility, whatever their score. */
const UNUSABLE_TYPES = new Set(["place", "street_center"]);

/** How many candidates to inspect. Beyond three, relevance falls away. */
export const MAX_CANDIDATES = 3;

/**
 * USPS suffix equivalences.
 *
 * "Nellieville Road" and "Nellieville Rd" are the same street written two
 * ways, and treating them as different would send a coach to a confirmation
 * dialog for nothing. Route designations are deliberately ABSENT: "GA-49" and
 * "Gray Hwy" are the same road but not the same NAME, and a coach navigates by
 * the number.
 */
const SUFFIXES = [
  ["road", "rd"], ["street", "st"], ["avenue", "ave"], ["drive", "dr"],
  ["lane", "ln"], ["boulevard", "blvd"], ["court", "ct"], ["circle", "cir"],
  ["place", "pl"], ["trail", "trl"], ["parkway", "pkwy"], ["highway", "hwy"],
  ["terrace", "ter"], ["square", "sq"], ["route", "rte"],
];

const SUFFIX_CANON = new Map();
for (const [long, short] of SUFFIXES) {
  SUFFIX_CANON.set(long, short);
  SUFFIX_CANON.set(short, short);
}

/** Lowercase, strip punctuation, canonicalise suffix words. */
export function normalizeStreet(value) {
  const words = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words.map((w) => SUFFIX_CANON.get(w) ?? w).join(" ");
}

const normalizeText = (v) =>
  String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const sameStreet = (a, b) => {
  const x = normalizeStreet(a);
  const y = normalizeStreet(b);
  return x.length > 0 && x === y;
};

/**
 * Is this candidate consistent with what the coach typed?
 *
 * House number, city and state must all agree. A candidate that moves the
 * facility to another town, or to a different number on the same street, is
 * not a verification of the coach's entry — it is a different address.
 */
export function isConsistent(stored, candidate) {
  if (!candidate) return false;

  const storedNumber = houseNumberOf(stored.streetAddress);
  if (!storedNumber || !candidate.number) return false;
  if (String(storedNumber).trim() !== String(candidate.number).trim()) return false;

  if (!stored.city || !candidate.city) return false;
  if (normalizeText(stored.city) !== normalizeText(candidate.city)) return false;

  if (!stored.state || !candidate.state) return false;
  if (String(stored.state).trim().toUpperCase() !== String(candidate.state).trim().toUpperCase()) {
    return false;
  }

  return true;
}

/** Leading house number, when the coach entered one. */
export function houseNumberOf(streetAddress) {
  const m = String(streetAddress ?? "").trim().match(/^(\d+[a-zA-Z]?)\b/);
  return m ? m[1] : null;
}

/** Street name with the leading house number removed. */
export function streetNameOf(streetAddress) {
  return String(streetAddress ?? "").trim().replace(/^\d+[a-zA-Z]?\s+/, "").trim();
}

/**
 * Decide what to do with a set of normalised Geocodio candidates.
 *
 * Returns one of three statuses, never a silent rewrite:
 *
 *   verified      the address is confirmed as entered; at most a ZIP is added
 *   confirm       a plausible alternative exists; the coach chooses
 *   unusable      nothing here can complete a facility address
 *
 * `changes` is only ever populated for `verified`, and only with fields that
 * are safe to apply without asking.
 */
export function decideAddress(stored, candidates = []) {
  const usable = (candidates ?? [])
    .slice(0, MAX_CANDIDATES)
    .filter((c) => c && !UNUSABLE_TYPES.has(c.accuracyType));

  if (usable.length === 0) {
    return {
      status: "unusable",
      reason: (candidates ?? []).length === 0 ? "no_results" : "insufficient_precision",
      suggestion: null,
      changes: {},
    };
  }

  /**
   * A consistent ROOFTOP candidate wins regardless of rank or score — the Al
   * Bishop case, where the rooftop result was both lower-scored and second.
   */
  const rooftop = usable.find(
    (c) => c.accuracyType === AUTO_TYPE && isConsistent(stored, c)
  );

  if (rooftop) {
    const storedStreetName = streetNameOf(stored.streetAddress);

    /**
     * Street text must agree after suffix normalisation. "Road" -> "Rd"
     * verifies silently; "GA-49" -> "Gray Hwy" does not, because replacing a
     * route designation with a local alias changes what the coach wrote and
     * what their families will look for.
     */
    if (!sameStreet(storedStreetName, rooftop.street)) {
      return {
        status: "confirm",
        reason: "street_name_differs",
        suggestion: rooftop,
        changes: {},
      };
    }

    /**
     * ZIP is filled only here: a rooftop result, consistent house number, city
     * and state, and a matching street. A facility with no street address can
     * never reach this branch, so it can never be given a ZIP that describes
     * only its town.
     */
    const changes = {};
    if (!stored.zip && rooftop.zip) changes.zip = rooftop.zip;
    if (stored.zip && rooftop.zip && String(stored.zip).trim() !== String(rooftop.zip).trim()) {
      return { status: "confirm", reason: "zip_differs", suggestion: rooftop, changes: {} };
    }

    /**
     * The coach's own text is kept. Geocodio lowercased "DeJarnette" to
     * "Dejarnette"; the coach's casing of a proper noun is more correct than
     * the vendor's, and normalisation already proved the two strings mean the
     * same street. formatted_address is never stored.
     */
    return {
      status: "verified",
      reason: changes.zip ? "verified_zip_added" : "verified",
      suggestion: rooftop,
      changes,
    };
  }

  /**
   * Everything else is a suggestion. Interpolated results reach here always:
   * the house number was estimated from a street range, not observed, so it
   * must never silently replace what a coach entered.
   */
  return {
    status: "confirm",
    reason: usable[0].accuracyType === "range_interpolation" ? "interpolated" : "not_consistent",
    suggestion: usable[0],
    changes: {},
  };
}

/** Coach-facing wording. Kept beside the rules so the two cannot drift. */
export function describeDecision(decision) {
  switch (decision.reason) {
    case "verified":
      return "Address verified.";
    case "verified_zip_added":
      return `Address verified. Added ZIP ${decision.changes.zip}.`;
    case "street_name_differs":
      return "We found this address under a different street name. Which would you like to keep?";
    case "zip_differs":
      return "We found a different ZIP for this address. Which would you like to keep?";
    case "interpolated":
      return "We found a close match but couldn't verify it exactly. Which would you like to keep?";
    case "not_consistent":
      return "We found a nearby address that doesn't quite match what you entered.";
    case "insufficient_precision":
      return "We could only match this to a street or town, so we couldn't verify the address. It will be saved as you entered it.";
    case "no_results":
    default:
      return "We couldn't verify this address. It will be saved as you entered it.";
  }
}
