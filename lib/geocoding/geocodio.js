/**
 * The Geocodio integration boundary.
 *
 * THE ONLY PLACE a raw Geocodio response is ever touched. Everything outside
 * this file consumes `normaliseResult()` output, which is built field by field
 * — so anything the vendor returns that is not named here cannot reach an
 * application payload, the database, client state, a log or analytics.
 *
 * SERVER ONLY. This module is imported exclusively by a server action, never
 * by a client component, so the API key cannot enter the browser bundle — a
 * server action's body is not shipped to the client. The `server-only` package
 * would enforce that at build time, but adding a dependency is outside this
 * phase; scripts/check-conventions.js asserts the import graph instead.
 *
 * DELIBERATELY DISCARDED:
 *
 *   location.lat / location.lng — every one of the twelve dry-run results
 *     carried coordinates. Season Tempo's facility model is address-first and
 *     stores no coordinates, and the way to keep it that way is to never copy
 *     the field, not to remember not to save it.
 *
 *   stable_address_key — the dry run showed it agrees with the two duplicate
 *     pairs we already detect by string matching, but showed no case it
 *     catches that string matching misses. Until there is evidence it improves
 *     detection it is not returned, not persisted, and not consumed by
 *     same_address. `KEY_FIELD` below marks where it would be read if that
 *     evidence ever arrives.
 *
 *   match_type, source, county, address_lines, formatted_address — not needed
 *     to decide or display. formatted_address in particular is never stored:
 *     components are applied selectively.
 */

const GEOCODIO_BASE = "https://api.geocod.io/v2/geocode";

/** Where a stable address key would be read, if it is ever justified. */
const KEY_FIELD = "stable_address_key";
void KEY_FIELD;

/**
 * One Geocodio result, reduced to the fields the decision layer uses.
 *
 * Built by naming each field. No spread, no Object.assign, no passthrough —
 * an added vendor field cannot appear here without someone writing it.
 */
function normaliseResult(raw) {
  if (!raw) return null;
  const c = raw.address_components ?? {};

  return {
    number: c.number ?? null,
    street: c.formatted_street ?? null,
    city: c.city ?? null,
    // v2 renamed `state` to `state_province` and `zip` to `postal_code`.
    state: c.state_province ?? null,
    zip: c.postal_code ?? null,
    // Drives every decision.
    accuracyType: raw.accuracy_type ?? null,
    // Secondary information only. Never compared to a threshold: the dry run
    // returned accuracy 1 for a rooftop hit, an interpolation, a street centre
    // and an entire town.
    accuracy: typeof raw.accuracy === "number" ? raw.accuracy : null,
  };
}

/** Strips the key from any error text before it can be surfaced or logged. */
function redact(text, apiKey) {
  const s = String(text ?? "");
  return apiKey ? s.split(apiKey).join("[REDACTED]") : s;
}

/**
 * Look up one address.
 *
 * Never throws: a facility must be saveable when Geocodio is slow, rate
 * limited, misconfigured or down. Failure returns an empty candidate list and
 * the decision layer resolves it to "unusable", which saves the coach's entry
 * unchanged.
 *
 * Authentication is an `Authorization: Bearer` header, never a query
 * parameter, so the key cannot land in a URL, a redirect or a request log.
 */
export async function geocodeAddress({ streetAddress, city, state, zip }) {
  const apiKey = process.env.GEOCODIO_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured", candidates: [] };

  const query = [streetAddress, city, [state, zip].filter(Boolean).join(" ")]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(", ");

  // A town alone can only ever produce a `place` result, which is unusable.
  // Not asking is cheaper than asking and discarding, and it is one fewer
  // billable lookup.
  if (!streetAddress || !String(streetAddress).trim()) {
    return { ok: false, reason: "no_street_address", candidates: [] };
  }

  try {
    // country=USA is explicit: Geocodio otherwise infers it from the address
    // shape, which is an uncontrolled variable on entries like "436 GA-49".
    const url = `${GEOCODIO_BASE}?q=${encodeURIComponent(query)}&country=USA`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return {
        ok: false,
        reason: "lookup_failed",
        detail: redact(body?.error, apiKey),
        candidates: [],
      };
    }

    const body = await res.json();
    const results = Array.isArray(body?.results) ? body.results : [];

    return { ok: true, candidates: results.map(normaliseResult).filter(Boolean) };
  } catch {
    // Network failure, timeout, malformed JSON. Never surfaced as an error the
    // coach has to clear — the address is simply unverified.
    return { ok: false, reason: "lookup_failed", candidates: [] };
  }
}
