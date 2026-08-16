/**
 * TEMPORARY — Geocodio accuracy dry run. DELETE AFTER EVALUATION.
 *
 * Purpose: measure where Geocodio's confidence bands actually fall on the
 * kinds of addresses Season Tempo stores — municipal ballfields, softball
 * complexes, highway-style routes, and records missing a ZIP or a street.
 * We need that evidence before choosing the accuracy threshold at which an
 * address-first lookup is allowed to overwrite a stored facility address.
 *
 * This route is deliberately inert with respect to the product:
 *   - reads GEOCODIO_API_KEY from process.env, server-side only
 *   - the key is never returned, never logged, and never placed in a URL
 *     when header auth is available
 *   - the twelve test addresses are literals copied from production rows;
 *     nothing is read from Supabase and nothing is written anywhere
 *   - no product module imports this file, and it imports none of theirs
 *
 * Access: /api/* is not in the middleware's public list, so an unauthenticated
 * request is redirected to /login before reaching this handler. On a Preview
 * deployment, Vercel Deployment Protection applies on top of that.
 *
 * Once the results are captured, delete this file and the temporary branch,
 * remove GEOCODIO_API_KEY from the project, and rotate the key at Geocodio.
 *
 * Runs on branch temp/geocodio-dryrun only. This file was briefly committed to
 * main and deployed to production by mistake; that commit has been reverted and
 * the route now exists solely on this branch, where it builds as a Preview and
 * can read the Preview-scoped key. It must never be merged to main.
 */

import { NextResponse } from "next/server";

// Never prerender or cache: this handler makes outbound calls and must only
// ever run on a real request. Without this, Next 14 would treat a GET handler
// with no dynamic input as static and could execute it at build time.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const GEOCODIO_BASE = "https://api.geocod.io/v2/geocode";

/**
 * The approved test set — twelve production facility rows, verified present
 * in `public.facilities` before packaging. `streetAddress: null` reproduces a
 * genuine null column; it is not a placeholder.
 *
 * `tests` records why each row is in the set so the report is self-describing.
 */
const TEST_FACILITIES = [
  { atlasId: "GA-0004", name: "Hobgood Park", streetAddress: "6688 Bells Ferry Rd", city: "Woodstock", state: "GA", zip: "30189", tests: "complete address" },
  { atlasId: "GA-0001", name: "Al Bishop Softball Complex", streetAddress: "1082 Al Bishop Dr", city: "Marietta", state: "GA", zip: "30008", tests: "complete address" },
  { atlasId: "GA-0073", name: "Doughty Park", streetAddress: "1200 Nellieville Road", city: "Augusta", state: "GA", zip: null, tests: "no ZIP; spelled-out street suffix" },
  { atlasId: "GA-0079", name: "Eagle Field at GS Softball Complex", streetAddress: "615 Fair Rd", city: "Statesboro", state: "GA", zip: null, tests: "no ZIP" },
  { atlasId: "GA-0090", name: "49 Recreation Complex", streetAddress: "436 GA-49", city: "Macon", state: "GA", zip: "31211", tests: "highway-style route" },
  { atlasId: "FL-0017", name: "Boombah-Soldiers Creek Park", streetAddress: "2400 FL-419", city: "Longwood", state: "FL", zip: "32750", tests: "highway-style route" },
  { atlasId: "TN-0030", name: "Maynard Glenn Ballfields", streetAddress: "McClung Ave", city: "Knoxville", state: "TN", zip: "37920", tests: "street with no house number" },
  { atlasId: "FL-0044", name: "Champions Park", streetAddress: null, city: "Newberry", state: "FL", zip: null, tests: "no street address at all" },
  { atlasId: "FL-0037", name: "Miss Sarasota Softball Complex", streetAddress: "4770 17th St", city: "Sarasota", state: "FL", zip: "34235", tests: "duplicate pair A — same_address regression check" },
  { atlasId: "FL-0043", name: "17th Street Regional Park", streetAddress: "4770 17th St", city: "Sarasota", state: "FL", zip: "34235", tests: "duplicate pair A — same_address regression check" },
  { atlasId: "TN-0011", name: "Star*Plex at McKnight Park", streetAddress: "120 DeJarnette Ln", city: "Murfreesboro", state: "TN", zip: "37130", tests: "duplicate pair B — same_address regression check" },
  { atlasId: "TN-0012", name: "McKnight Park Youth Softball Fields", streetAddress: "120 DeJarnette Ln", city: "Murfreesboro", state: "TN", zip: "37130", tests: "duplicate pair B — same_address regression check" },
];

/**
 * Builds the address-first query string.
 *
 * Address-first is the approved Phase 3 behaviour: the facility name is
 * deliberately excluded. Geocodio is an address geocoder, not a place search,
 * and including the name would make a name-matched hit indistinguishable from
 * a genuine address match — which is precisely what this run must measure.
 */
function buildQuery(f) {
  return [f.streetAddress, f.city, [f.state, f.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

/**
 * Removes the key from any string before it can reach a response or a log.
 *
 * Defence in depth. Nothing below is expected to contain the key, but an
 * upstream error message that echoed a request URL would otherwise leak it
 * into the Vercel runtime log, where it would outlive the branch.
 */
function redact(text, apiKey) {
  const s = String(text ?? "");
  return apiKey ? s.split(apiKey).join("[REDACTED]") : s;
}

/**
 * One forward-geocode call.
 *
 * Authentication is by `Authorization: Bearer` header only. Geocodio documents
 * both a header and an `api_key` query parameter for v2; the header is the one
 * we use so the key never enters a URL, a redirect, or a Vercel request log.
 * There is deliberately no query-parameter fallback — a fallback would put the
 * key in a URL under exactly the failure conditions we can least observe.
 *
 * `country=USA` is sent explicitly. Geocodio otherwise infers country from the
 * address format and falls back to USA, which would leave inference as an
 * uncontrolled variable on entries like "436 GA-49" — and this run exists to
 * measure accuracy, not to measure Geocodio's guess about which country we
 * meant. Every facility in the test set is in the US.
 */
async function geocodeOne(query, apiKey) {
  const url = `${GEOCODIO_BASE}?q=${encodeURIComponent(query)}&country=USA`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * Flattens one Geocodio result into the fields we actually evaluate.
 *
 * The full first result is returned alongside this summary. If any assumption
 * about Geocodio's shape is wrong, the raw object still carries the data and
 * we do not need a second deployment to find that out.
 */
function summarise(result) {
  if (!result) return null;
  const c = result.address_components ?? {};
  return {
    formattedAddress: result.formatted_address ?? null,
    // v2 renamed `state` to `state_province` and `zip` to `postal_code`.
    // Reading the v1 names here returned null for both.
    street: c.formatted_street ?? null,
    houseNumber: c.number ?? null,
    city: c.city ?? null,
    state: c.state_province ?? null,
    zip: c.postal_code ?? null,
    county: c.county ?? null,
    accuracy: result.accuracy ?? null,
    accuracyType: result.accuracy_type ?? null,
    // v2 additions. `match_type` distinguishes a unit-level hit from a
    // building centroid; `stable_address_key` is a persistent per-address
    // identifier that may prove a stronger duplicate signal than string
    // comparison. Captured for evaluation, not used for anything yet.
    matchType: result.match_type ?? null,
    stableAddressKey: result.stable_address_key ?? null,
    source: result.source ?? null,
  };
}

export async function GET() {
  const apiKey = process.env.GEOCODIO_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEOCODIO_API_KEY is not set in this environment." },
      { status: 500 }
    );
  }

  const findings = [];

  for (const f of TEST_FACILITIES) {
    const query = buildQuery(f);
    const stored = {
      streetAddress: f.streetAddress,
      city: f.city,
      state: f.state,
      zip: f.zip,
    };

    try {
      const { status, body } = await geocodeOne(query, apiKey);

      if (status !== 200) {
        findings.push({
          atlasId: f.atlasId,
          name: f.name,
          tests: f.tests,
          inputQuery: query,
          stored,
          error: `HTTP ${status}`,
          detail: redact(body?.error, apiKey),
        });
        continue;
      }

      const results = Array.isArray(body?.results) ? body.results : [];

      findings.push({
        atlasId: f.atlasId,
        name: f.name,
        tests: f.tests,
        inputQuery: query,
        stored,
        resultCount: results.length,
        top: summarise(results[0]),
        // Second result included only where one exists: a close runner-up is
        // itself a signal that the top hit should not be trusted blindly.
        runnerUpAccuracy: results[1]?.accuracy ?? null,
        runnerUpType: results[1]?.accuracy_type ?? null,
        rawTopResult: results[0] ?? null,
      });
    } catch (err) {
      findings.push({
        atlasId: f.atlasId,
        name: f.name,
        tests: f.tests,
        inputQuery: query,
        stored,
        error: "Request failed",
        detail: redact(err?.message, apiKey),
      });
    }
  }

  return NextResponse.json(
    {
      note: "Temporary Geocodio dry run. Read-only. No database access.",
      apiVersion: "v2",
      authMethod: "Authorization: Bearer header",
      generatedAt: new Date().toISOString(),
      requestedCount: TEST_FACILITIES.length,
      returnedCount: findings.length,
      findings,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
