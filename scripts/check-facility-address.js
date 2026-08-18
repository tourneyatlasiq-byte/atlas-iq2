/**
 * Facility address validation — regression cases.
 *
 * Every case below replays a real Geocodio result from the production dry run,
 * so the rules are tested against what the vendor actually returned rather
 * than what we assumed it would return.
 *
 * Run:  node scripts/check-facility-address.js
 */
const { pathToFileURL } = require("url");
const path = require("path");

let failures = 0;
let ran = 0;

function assertEq(label, actual, expected) {
  ran += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

/** Candidate as the Geocodio boundary normalises it. No lat/lng, no key. */
const cand = (number, street, city, state, zip, accuracyType, accuracy) =>
  ({ number, street, city, state, zip, accuracyType, accuracy });

(async () => {
  const m = await import(pathToFileURL(path.resolve("lib/facility-address-rules.js")).href);
  const { decideAddress, normalizeStreet, isConsistent, houseNumberOf, streetNameOf } = m;

  console.log("\nFacility address validation — 12 production dry-run cases\n");

  const verdict = (stored, candidates) => decideAddress(stored, candidates).status;

  /* ---- VERIFIED (5) ------------------------------------------------- */

  // GA-0004 Hobgood Park. Rooftop, everything agrees. NOTE the real stored
  // address is 6688 Bells Ferry Rd.
  const ga0004 = {
    stored: { streetAddress: "6688 Bells Ferry Rd", city: "Woodstock", state: "GA", zip: "30189" },
    candidates: [cand("6688", "Bells Ferry Rd", "Woodstock", "GA", "30189", "rooftop", 1)],
  };
  assertEq("GA-0004 rooftop, exact match -> verified", verdict(ga0004.stored, ga0004.candidates), "verified");
  assertEq("GA-0004 changes nothing", decideAddress(ga0004.stored, ga0004.candidates).changes, {});

  // GA-0073 Doughty Park. "Road" -> "Rd" is normalisation, and the ZIP was
  // missing. Both safe on a rooftop result.
  const ga0073 = {
    stored: { streetAddress: "1200 Nellieville Road", city: "Augusta", state: "GA", zip: null },
    candidates: [cand("1200", "Nellieville Rd", "Augusta", "GA", "30901", "rooftop", 1)],
  };
  assertEq("GA-0073 Road->Rd still verifies", verdict(ga0073.stored, ga0073.candidates), "verified");
  assertEq("GA-0073 adds the missing ZIP", decideAddress(ga0073.stored, ga0073.candidates).changes, { zip: "30901" });

  const ga0079 = {
    stored: { streetAddress: "615 Fair Rd", city: "Statesboro", state: "GA", zip: null },
    candidates: [cand("615", "Fair Rd", "Statesboro", "GA", "30458", "rooftop", 1)],
  };
  assertEq("GA-0079 rooftop, missing ZIP -> verified", verdict(ga0079.stored, ga0079.candidates), "verified");
  assertEq("GA-0079 adds the missing ZIP", decideAddress(ga0079.stored, ga0079.candidates).changes, { zip: "30458" });

  // TN-0011 / TN-0012. Geocodio lowercased the proper noun.
  const tnStored = { streetAddress: "120 DeJarnette Ln", city: "Murfreesboro", state: "TN", zip: "37130" };
  const tnCands = [
    cand("120", "Dejarnette Ln", "Murfreesboro", "TN", "37130", "rooftop", 1),
    cand("120", "Dejarnette Ln", "Murfreesboro", "TN", "37130", "range_interpolation", 1),
  ];
  assertEq("TN-0011 rooftop despite casing -> verified", verdict(tnStored, tnCands), "verified");
  assertEq("TN-0012 same", verdict(tnStored, tnCands), "verified");
  assertEq("coach's DeJarnette casing is never overwritten",
    decideAddress(tnStored, tnCands).changes, {});

  /* ---- CONFIRMATION REQUIRED (5) ------------------------------------ */

  // GA-0090. Route designation replaced by a local alias. Same road, but not
  // the name a coach or family navigates by.
  const ga0090 = {
    stored: { streetAddress: "436 GA-49", city: "Macon", state: "GA", zip: "31211" },
    candidates: [cand("436", "Gray Hwy", "Macon", "GA", "31211", "range_interpolation", 1)],
  };
  assertEq("GA-0090 GA-49 -> Gray Hwy requires confirmation", verdict(ga0090.stored, ga0090.candidates), "confirm");

  // FL-0017. ROOFTOP, consistent number/city/state — but the street name
  // changes, so it is a confirmation, not a silent verification.
  const fl0017 = {
    stored: { streetAddress: "2400 FL-419", city: "Longwood", state: "FL", zip: "32750" },
    candidates: [cand("2400", "State Hwy 419", "Longwood", "FL", "32750", "rooftop", 1)],
  };
  assertEq("FL-0017 rooftop but FL-419 -> State Hwy 419 requires confirmation",
    verdict(fl0017.stored, fl0017.candidates), "confirm");
  assertEq("FL-0017 reason is the street name, not precision",
    decideAddress(fl0017.stored, fl0017.candidates).reason, "street_name_differs");
  assertEq("FL-0017 applies no change without the coach",
    decideAddress(fl0017.stored, fl0017.candidates).changes, {});

  // FL-0037 / FL-0043. Interpolated: the house number was estimated.
  const flSarasota = {
    stored: { streetAddress: "4770 17th St", city: "Sarasota", state: "FL", zip: "34235" },
    candidates: [cand("4770", "17th St", "Sarasota", "FL", "34235", "range_interpolation", 1)],
  };
  assertEq("FL-0037 interpolation requires confirmation", verdict(flSarasota.stored, flSarasota.candidates), "confirm");
  assertEq("FL-0043 same", verdict(flSarasota.stored, flSarasota.candidates), "confirm");
  assertEq("interpolation never silently replaces an entered address",
    decideAddress(flSarasota.stored, flSarasota.candidates).changes, {});

  // GA-0001 Al Bishop, as actually captured: only the top interpolation had
  // components. The dry run recorded the runner-up's type and score but not
  // its address, so with the real payload this is a confirmation.
  const ga0001 = {
    stored: { streetAddress: "1082 Al Bishop Dr", city: "Marietta", state: "GA", zip: "30008" },
    candidates: [cand("1082", "Al Bishop Dr", "Marietta", "GA", "30008", "range_interpolation", 0.93)],
  };
  assertEq("GA-0001 with only the interpolation -> confirm", verdict(ga0001.stored, ga0001.candidates), "confirm");

  /* ---- THE AL BISHOP RULE: rank and score do not decide -------------- */

  const alBishopFull = [
    cand("1082", "Al Bishop Dr", "Marietta", "GA", "30008", "range_interpolation", 0.93),
    cand("1082", "Al Bishop Dr", "Marietta", "GA", "30008", "rooftop", 0.9),
  ];
  assertEq("a LOWER-scored rooftop at rank 2 beats a higher-scored interpolation",
    verdict(ga0001.stored, alBishopFull), "verified");
  assertEq("...and accuracy 0.9 is not rejected for being under any threshold",
    decideAddress(ga0001.stored, alBishopFull).suggestion.accuracy, 0.9);

  /* ---- UNUSABLE (2) -------------------------------------------------- */

  // TN-0030. accuracy 1, but street_center: no house number, so it describes
  // a street and not a facility.
  const tn0030 = {
    stored: { streetAddress: "McClung Ave", city: "Knoxville", state: "TN", zip: "37920" },
    candidates: [cand(null, "McClung Ave", "Knoxville", "TN", "37920", "street_center", 1)],
  };
  assertEq("TN-0030 street_center is unusable despite accuracy 1", verdict(tn0030.stored, tn0030.candidates), "unusable");

  // FL-0044. accuracy 1 for returning an entire town.
  const fl0044 = {
    stored: { streetAddress: null, city: "Newberry", state: "FL", zip: null },
    candidates: [cand(null, null, "Newberry", "FL", "32669", "place", 1)],
  };
  assertEq("FL-0044 place is unusable despite accuracy 1", verdict(fl0044.stored, fl0044.candidates), "unusable");
  assertEq("FL-0044 is NEVER given the town's ZIP — no false completeness",
    decideAddress(fl0044.stored, fl0044.candidates).changes, {});

  /* ---- accuracy is never a gate -------------------------------------- */

  assertEq("accuracy 1 does not rescue place or street_center",
    [verdict(tn0030.stored, tn0030.candidates), verdict(fl0044.stored, fl0044.candidates)],
    ["unusable", "unusable"]);

  /* ---- consistency rules --------------------------------------------- */

  const stored4 = { streetAddress: "100 Main St", city: "Macon", state: "GA", zip: "31201" };
  assertEq("a different house number is not a verification",
    verdict(stored4, [cand("102", "Main St", "Macon", "GA", "31201", "rooftop", 1)]), "confirm");
  assertEq("a different city is not a verification",
    verdict(stored4, [cand("100", "Main St", "Warner Robins", "GA", "31088", "rooftop", 1)]), "confirm");
  assertEq("a different state is not a verification",
    verdict(stored4, [cand("100", "Main St", "Macon", "FL", "31201", "rooftop", 1)]), "confirm");
  assertEq("a different ZIP is a confirmation, never a silent overwrite",
    verdict(stored4, [cand("100", "Main St", "Macon", "GA", "31299", "rooftop", 1)]), "confirm");

  /* ---- degradation ---------------------------------------------------- */

  assertEq("no results is unusable, not an error", verdict(stored4, []), "unusable");
  assertEq("a Geocodio outage never blocks saving",
    decideAddress(stored4, []).changes, {});

  /* ---- normalisation boundaries -------------------------------------- */

  assertEq("suffix words normalise", 
    [normalizeStreet("Nellieville Road"), normalizeStreet("Nellieville Rd")],
    ["nellieville rd", "nellieville rd"]);
  assertEq("casing and punctuation normalise",
    normalizeStreet("DeJarnette Ln") === normalizeStreet("Dejarnette Ln"), true);
  assertEq("route designations do NOT normalise to local aliases",
    normalizeStreet("GA-49") === normalizeStreet("Gray Hwy"), false);
  assertEq("nor do state route aliases",
    normalizeStreet("FL-419") === normalizeStreet("State Hwy 419"), false);
  assertEq("house number parsing", 
    [houseNumberOf("6688 Bells Ferry Rd"), houseNumberOf("McClung Ave"), houseNumberOf(null)],
    ["6688", null, null]);
  assertEq("street name strips the number", streetNameOf("6688 Bells Ferry Rd"), "Bells Ferry Rd");
  assertEq("a street-less facility is never consistent",
    isConsistent({ streetAddress: null, city: "Newberry", state: "FL" },
      cand(null, null, "Newberry", "FL", "32669", "place", 1)), false);

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
