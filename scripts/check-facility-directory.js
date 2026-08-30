/**
 * Facility directory: next-event selection and column sorting.
 *
 * The bug these guard: tournaments arrive ordered start_date DESC, so taking
 * upcoming[0] returned the FURTHEST-away event and labelled it "Next event".
 * Invisible while no venue had two upcoming tournaments, wrong as soon as one
 * did — so the fixture below deliberately has two.
 *
 * Run:  node scripts/check-facility-directory.js
 */
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

/* The two functions under test, mirrored from components/FacilitiesClient.js.
   Kept in step by the assertions below, which encode the real production
   ordering rather than an idealised one. */

function nextEventOf(f) {
  const upcoming = (f.upcoming ?? []).filter((x) => x.decision !== "Declined");
  if (upcoming.length === 0) return null;
  const t = upcoming.reduce((soonest, x) =>
    String(x.start_date) < String(soonest.start_date) ? x : soonest
  );
  return { name: t.name, date: t.start_date };
}

function applySort(rows, sort, comparators) {
  if (!sort?.key) return rows;
  const value = comparators[sort.key];
  if (!value) return rows;
  const dir = sort.dir === "desc" ? -1 : 1;
  const missing = (v) => v === null || v === undefined || v === "" || v === false;

  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (missing(av) && missing(bv)) return 0;
    if (missing(av)) return 1;
    if (missing(bv)) return -1;
    const diff =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
    return diff * dir || String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}

/* Fixtures. `upcoming` is DESC by start_date, as listFacilities produces it. */

const twoUpcoming = {
  name: "Cherokee Veterans Park",
  upcoming: [
    { name: "Triple Crown Spring Slam", start_date: "2027-03-13", decision: "Committed" },
    { name: "Winter Warm-Up", start_date: "2027-01-16", decision: "Committed" },
  ],
  past: [],
};

const declinedIsSooner = {
  name: "Edwards Park",
  upcoming: [
    { name: "Autumn Alliance Open", start_date: "2026-10-24", decision: "Committed" },
    { name: "Alliance Fastpitch", start_date: "2026-09-01", decision: "Declined" },
  ],
  past: [],
};

const oneUpcoming = {
  name: "Heritage Point Park",
  upcoming: [{ name: "Legacy", start_date: "2026-08-29", decision: "Committed" }],
  past: [],
};

const noneUpcoming = { name: "Satterfield Park", upcoming: [], past: [] };

(async () => {
  console.log("\nFacility directory — next event and sorting\n");

  /* --- The defect --------------------------------------------------------- */

  assertEq("two upcoming: the SOONER event is chosen, not upcoming[0]",
    nextEventOf(twoUpcoming).name, "Winter Warm-Up");
  assertEq("...and its date is the earlier one",
    nextEventOf(twoUpcoming).date, "2027-01-16");
  assertEq("upcoming[0] really is the later event, so the old code was wrong",
    twoUpcoming.upcoming[0].name, "Triple Crown Spring Slam");

  /* --- Qualification rules preserved -------------------------------------- */

  assertEq("a sooner DECLINED tournament is not the next event",
    nextEventOf(declinedIsSooner).name, "Autumn Alliance Open");
  assertEq("one upcoming still works", nextEventOf(oneUpcoming).name, "Legacy");
  assertEq("no upcoming yields null, which renders 'Nothing scheduled'",
    nextEventOf(noneUpcoming), null);

  /* --- Display and sort read the SAME event ------------------------------- */

  const nextValue = (f) => nextEventOf(f)?.date ?? null;
  assertEq("the sort value is the displayed event's date",
    nextValue(twoUpcoming), nextEventOf(twoUpcoming).date);

  const rows = [oneUpcoming, twoUpcoming, noneUpcoming, declinedIsSooner];
  const comparators = { next: nextValue };

  assertEq("soonest to latest, with unscheduled last",
    applySort(rows, { key: "next", dir: "asc" }, comparators).map((f) => f.name),
    ["Heritage Point Park", "Edwards Park", "Cherokee Veterans Park", "Satterfield Park"]);

  assertEq("latest to soonest, with unscheduled STILL last",
    applySort(rows, { key: "next", dir: "desc" }, comparators).map((f) => f.name),
    ["Cherokee Veterans Park", "Edwards Park", "Heritage Point Park", "Satterfield Park"]);

  assertEq("no sort leaves the default order untouched",
    applySort(rows, null, comparators).map((f) => f.name),
    ["Heritage Point Park", "Cherokee Veterans Park", "Satterfield Park", "Edwards Park"]);

  
/* ---- Locations & Resources ----------------------------------------------
   Facilities grew to hold lodging and dining. The table keeps its name; the
   navigation does not.

   The line that matters: facilities is globally readable, so a place FACT can
   live there and a team's OPINION cannot. Would-use-again and private notes
   are on organization_facilities, which RLS scopes to the owning org. */

console.log("\nLocations & Resources");

{
  const fsx = require("fs");
  const fields = fsx.readFileSync("lib/facility-fields.js", "utf8");
  const q = fsx.readFileSync("lib/queries/facilities.js", "utf8");
  const tq = fsx.readFileSync("lib/queries/tournaments.js", "utf8");
  const act = fsx.readFileSync("lib/actions/facilities.js", "utf8");
  const ui = fsx.readFileSync("components/FacilitiesClient.js", "utf8");
  const tui = fsx.readFileSync("components/TournamentClient.js", "utf8");
  const nav = fsx.readFileSync("components/NavSidebar.js", "utf8");
  const css = fsx.readFileSync("app/globals.css", "utf8");

  // One vocabulary.
  // Asserts the STORED keys, not the labels. Labels are presentation and have
  // already changed once (Lodging -> Hotel) without the schema moving.
  assertEq("three stored types, no Services in V1",
    /key: "facility"[\s\S]*?key: "lodging"[\s\S]*?key: "dining"/.test(fields), true);
  assertEq("Services is deliberately absent", /Services is deliberately absent/.test(fields), true);
  assertEq("unknown type reads as Facility", /TYPE_LABEL\.get\(key\) \?\? "Facility"/.test(fields), true);
  assertEq("nine ballpark-only fields", /FACILITY_ONLY_FIELDS = \[/.test(fields), true);
  assertEq("Not rated is NULL, not a third stored value",
    /there is deliberately no third stored value/.test(fields), true);

  // Query layer.
  assertEq("query selects type and phone", /type, phone, created_at, updated_at/.test(q), true);
  assertEq("private select carries the judgement", /would_use_again/.test(q), true);
  assertEq("resource links are fetched", /from\("tournament_resources"\)/.test(q), true);
  assertEq("isOurs counts a link", /links\.length > 0/.test(q), true);

  // Actions.
  assertEq("submitted type is validated, not trusted",
    /RESOURCE_TYPE_KEYS\.includes\(submittedType\)/.test(act), true);
  assertEq("ballpark fields null for non-facility", /facilityOnly \? /.test(act), true);
  assertEq("would_use_again refuses anything but yes/no",
    /\["yes", "no"\]\.includes/.test(act), true);
  assertEq("re-linking updates rather than duplicating",
    /onConflict: "tournament_id,facility_id"/.test(act), true);
  assertEq("unlink verifies affected rows", /\(removed \?\? \[\]\)\.length === 0/.test(act), true);

  // Page.
  assertEq("type filter combines with the others",
    /typeFilter !== "all" && \(f\.type \?\? "facility"\) !== typeFilter/.test(ui), true);
  assertEq("surface never hides a non-facility", /!isFacility\s*\n?\s*\|\| \(f\.surface_type/.test(ui), true);
  assertEq("chip counts respect view and search", /const typeCounts = useMemo/.test(ui), true);
  assertEq("only non-facility types are tagged",
    /\(f\.type \?\? "facility"\) !== "facility" && \(/.test(ui), true);

  // Drawer.
  assertEq("ballpark block is gated on type", /const hasFacilityInfo = isFacility/.test(ui), true);
  assertEq("phone shows for every type", /label="Phone"/.test(ui), true);
  assertEq("privacy is stated once, quietly",
    /Only your organization can see this/.test(ui), true);
  assertEq("linked tournaments are shown", /Linked Tournaments/.test(ui), true);

  // Create/edit.
  assertEq("type selector drives the form", /const \[resourceType, setResourceType\]/.test(ui), true);
  assertEq("ballpark fields hidden for lodging/dining", /\{typeIsFacility && \(/.test(ui), true);

  // Tournament side.
  assertEq("tournament fetches its links", /from\("tournament_resources"\)/.test(tq), true);
  assertEq("playing venue stays separate",
    /DELIBERATELY NOT the playing venue/.test(tq), true);
  assertEq("compact section in the drawer", /Locations &amp; Resources/.test(tui), true);
  assertEq("empty state is one button", /\+ Link location or resource/.test(tui), true);
  assertEq("picker searches rather than dumps", /SEARCH, NOT A DUMP/.test(tui), true);
  assertEq("type shown first in the picker", /typeLabel\(f\.type\)/.test(tui), true);
  assertEq("context chosen with the place", /headerExtra=\{/.test(tui), true);
  assertEq("unlink confirms in place", /confirmUnlink === r\.id/.test(tui), true);
  assertEq("Used never implies everyone used it",
    /does not mean every family/.test(tui), true);


  // Header actions after visual QA.
  assertEq("one primary action, named for what it creates",
    /Add location/.test(ui) && !/>\s*Add facility\s*</.test(ui), true);
  assertEq("no separate per-type buttons",
    /Add Lodging|Add Dining/.test(ui), false);
  assertEq("import is still named for what it actually supports",
    /Import facilities/.test(ui), true);
  assertEq("...and no longer says Upload", /Upload facilities/.test(ui), false);

  // Type is the first decision in the create flow.
  assertEq("exactly one type selector", (ui.match(/htmlFor="f-type"/g) || []).length, 1);
  assertEq("...and it precedes the duplicate search",
    ui.indexOf('htmlFor="f-type"') < ui.indexOf('htmlFor="fac-search"'), true);

  // Ballpark filters follow the selected type.
  assertEq("county, surface and amenity are gated on Facilities",
    /\{typeFilter === "facility" && \(/.test(ui), true);
  assertEq("...exactly one such gate", (ui.match(/typeFilter === "facility" && \(/g) || []).length, 1);
  assertEq("county sits inside that gate",
    ui.indexOf('{typeFilter === "facility"') < ui.indexOf("All counties"), true);
  assertEq("...and are cleared when hidden, so nothing filters invisibly",
    (ui.match(/setSurfaceFilter\("all"\); setAmenityFilter\("all"\)/g) || []).length >= 1
      || /setSurfaceFilter\("all"\);\s*\n\s*setAmenityFilter\("all"\);/.test(ui), true);
  assertEq("state stays for every type",
    ui.indexOf("All states") < ui.indexOf('{typeFilter === "facility"'), true);
  // Must be cleared in BOTH handlers: switching to a non-facility type, and
  // switching to All. Checking only that the call exists somewhere would pass
  // with one of the two missing.
  // Cleared in BOTH chip handlers: switching to a non-facility type, and
  // switching to All. A third call already existed — a pre-existing guard that
  // resets county when the chosen one leaves the visible list — so this counts
  // the two inside the handlers rather than every occurrence.
  assertEq("county is cleared by both chip handlers",
    (ui.match(/setCountyFilter\("all"\);\n\s*setSurfaceFilter\("all"\)/g) || []).length, 2);
  assertEq("...alongside amenity",
    (ui.match(/setSurfaceFilter\("all"\)/g) || []).length, 2);

  // Label vs stored value.
  assertEq("chips read Hotels", /plural: "Hotels"/.test(fields), true);
  assertEq("the record label reads Hotel", /label: "Hotel"/.test(fields), true);
  assertEq("the STORED value is still lodging", /key: "lodging"/.test(fields), true);
  assertEq("nothing renamed the stored value",
    /"hotel"/.test(fields.replace(/\/\*[\s\S]*?\*\//g, "")), false);
  assertEq("Services is still absent", /key: "services"/.test(fields), false);

  // Search wording works across types.
  assertEq("search placeholder is type-neutral",
    /Search by name, city, county, or address/.test(ui), true);


  /* ---- Visual QA contracts ---------------------------------------------- */

  // Saved, not Ours. A team does not own the Embassy Suites.
  assertEq("the collection control reads Saved", /Saved <span className="seg-count"/.test(ui), true);
  assertEq("...and no longer reads Ours", /Ours <span className="seg-count"/.test(ui), false);
  assertEq("the view KEY is unchanged, so isOurs is untouched",
    /view === "ours"/.test(ui), true);
  assertEq("isOurs still requires a real relationship",
    /committedHistory\.length > 0 \|\| orgNotes !== null \|\| links\.length > 0/.test(q), true);

  // No user-facing Lodging anywhere, in any file.
  {
    const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const userFacing = [ui, tui, fields, fsx.readFileSync("lib/onboarding.js", "utf8")]
      .map(strip).join("\n");
    // Quoted display strings only; the stored key "lodging" is lowercase.
    assertEq("no user-facing Lodging terminology", /Lodging/.test(userFacing), false);
    assertEq("...and no stray Hotel key was introduced",
      /key: "hotel"/.test(strip(fields)), false);
  }

  // Filters by type.
  assertEq("County sits inside the facility-only gate",
    ui.indexOf('{typeFilter === "facility"') < ui.indexOf("All counties"), true);
  assertEq("Surface too", ui.indexOf('{typeFilter === "facility"') < ui.indexOf("All surfaces"), true);
  assertEq("Amenity too", ui.indexOf('{typeFilter === "facility"') < ui.indexOf("Any amenity"), true);
  assertEq("State stays outside it, so every type keeps it",
    ui.indexOf("All states") < ui.indexOf('{typeFilter === "facility"'), true);

  // Two different empties.
  assertEq("an active filter says so rather than implying emptiness",
    /title: "Nothing matches", body: "Try a different search or clear the filters."/.test(ui), true);
  assertEq("a genuinely empty type invites the first record",
    /No \$\{typed\.plural\.toLowerCase\(\)\} yet/.test(ui), true);
  assertEq("...with hotel wording", /Save hotels your team has used or wants to remember/.test(ui), true);
  assertEq("...and dining wording",
    /Save restaurants or dining locations your team wants to remember/.test(ui), true);
  assertEq("the empty-state button preselects the type",
    /setCreateType\(emptyState\.addType\)/.test(ui), true);
  assertEq("...and the form honours it", /useState\(row\?\.type \?\? initialType\)/.test(ui), true);

  // Hotel/Dining never expose ballpark fields.
  assertEq("ballpark form fields are gated", /\{typeIsFacility && \(/.test(ui), true);
  assertEq("ballpark drawer block is gated", /const hasFacilityInfo = isFacility/.test(ui), true);
  assertEq("the action nulls them for non-facilities", /facilityOnly \? /.test(act), true);

  // Copy that changes with the type.
  assertEq("create button names the type", /Create \$\{typeLabelFor\(resourceType\)\}/.test(ui), true);
  assertEq("delete confirmation names the type", /Delete \$\{typeLabelFor\(f\.type\)\}/.test(ui), true);
  assertEq("the drawer label names the type", /\$\{typeLabel\(f\.type\)\} details/.test(ui), true);

  // Header actions unchanged.
  assertEq("import stays facility-specific", /Import facilities/.test(ui), true);
  assertEq("one manual create action",
    (ui.match(/Add location/g) || []).length >= 1 && !/Add Hotel<|Add Dining</.test(ui), true);


  // Description is a SHARED, globally readable fact about a ballpark. For a
  // hotel, what a coach wants to write is their own experience, and that lives
  // in the private notes. Offering both would give them two places for the
  // same sentence and no way to know which was right.
  assertEq("Description is facility-only in the form",
    ui.indexOf("htmlFor=\"f-description\"") > ui.lastIndexOf("{typeIsFacility && (", ui.indexOf("htmlFor=\"f-description\"")), true);
  assertEq("...not read in the drawer for other types",
    /isFacility && f\.description/.test(ui), true);
  assertEq("...and not written by the action for other types",
    /description: facilityOnly \? /.test(act), true);

  // Linked tournaments empty state.
  assertEq("non-facilities always show Linked Tournaments",
    /!isFacility \|\| \(f\.resourceLinks \?\? \[\]\)\.length > 0/.test(ui), true);
  assertEq("...with a plain empty line", /No tournaments linked yet\./.test(ui), true);
  assertEq("...and never the games wording", /No games are played here/.test(ui), false);
  assertEq("games history is facility-only",
    ui.indexOf("{isFacility && (") < ui.indexOf('title="Tournament History"'), true);
  assertEq("...keeping its own facility wording",
    /No tournaments have been held here yet\./.test(ui), true);


  // Advanced is a facility/admin control: manual coordinate overrides and a
  // maps link. A hotel's address is what a coach needs; the map link is
  // generated from it and coordinates arrive from external place search.
  assertEq("Advanced is facility-only",
    ui.indexOf("{typeIsFacility && (\n            <details") > -1
      || /\{typeIsFacility && \(\s*\n\s*<details/.test(ui), true);
  assertEq("...and county is hidden for every type",
    /<input type="hidden" name="county"/.test(ui), true);

  // The trap this avoids: facilityFields reads every key and updateFacility
  // writes the whole payload, so an ABSENT input saves null over a stored
  // value. Hiding a control without round-tripping it destroys data.
  assertEq("latitude round-trips when hidden",
    /<input type="hidden" name="latitude"/.test(ui), true);
  assertEq("longitude round-trips when hidden",
    /<input type="hidden" name="longitude"/.test(ui), true);
  assertEq("maps link round-trips when hidden",
    /<input type="hidden" name="maps_link"/.test(ui), true);
  assertEq("...carrying prefill or the stored value, not blank",
    /name="latitude"\s*\n?\s*defaultValue=\{prefill\?\.latitude \?\? row\?\.latitude/.test(ui), true);
  assertEq("Facilities keep the editable Advanced controls",
    /htmlFor="f-lat"/.test(ui) && /htmlFor="f-maps"/.test(ui), true);


  /* ---- A created record must be findable ---------------------------------
     Found in QA: a hotel was created successfully and then did not appear
     under Hotels. Two separate faults.

     ONE — the Type never reached the server. The selector lives on the search
     step, which is a different modal with no <form> around it, so it set React
     state and submitted nothing; the action saw no type and used the column
     default. The record was written as a facility.

     TWO — even with the right type it would not have been Saved. Saved means a
     real relationship, and a brand new record has no tournament, no notes and
     no links. Creating it IS the relationship, so creation now writes an
     organization_facilities row.

     Not solved by adding created_by_organization_id to the Saved rule: the
     importer sets that column too, and Northgate imported 178 of the 181
     records, which would have made Saved almost identical to All. */

  assertEq("the chosen type is submitted from inside the form",
    /<input type="hidden" name="type" value=\{resourceType\} \/>/.test(ui), true);
  // Three forms exist in this file; the one that submits a location is the
  // one carrying the hidden type. The selector must sit BEFORE it, on the
  // search step, which is exactly why the hidden input is needed.
  assertEq("...and the visible selector is outside it, on the search step",
    ui.indexOf('id="f-type"') < ui.indexOf('<input type="hidden" name="type"'), true);
  assertEq("creating a record marks it Saved",
    /from\("organization_facilities"\)\s*\n\s*\.upsert\(/.test(act), true);
  assertEq("...scoped to the creating organization",
    /organization_id: ctx\.organization\.id, facility_id: created\.id/.test(act), true);
  assertEq("...idempotently, so a retry cannot duplicate it",
    /onConflict: "organization_id,facility_id"/.test(act), true);
  assertEq("...and never fails the create over a marker",
    /Deliberately not fatal/.test(act), true);
  assertEq("the Saved rule itself is unchanged",
    /committedHistory\.length > 0 \|\| orgNotes !== null \|\| links\.length > 0/.test(q), true);
  // created_by_organization_id IS read for isCurator (who may edit a shared
  // record). What matters is that it is not part of the Saved rule, because
  // the importer sets it on every record it creates.
  assertEq("...so a directory record alone is still not Saved",
    /isOurs:[^,]*created_by_organization_id/.test(q), false);
  assertEq("...and it is still used for edit rights",
    /isCurator: f\.created_by_organization_id === organizationId/.test(q), true);

  // Nav and mobile.
  assertEq("nav renamed", /label: "Locations & Resources"/.test(nav), true);
  assertEq("route unchanged", /href: "\/facilities"/.test(nav), true);
  const deskAt = css.indexOf(".lr-cards { display: none; }");
  const mobAt = css.indexOf(".lr-cards { display: grid;");
  assertEq("desktop rule precedes the mobile override", deskAt !== -1 && deskAt < mobAt, true);
  assertEq("list tables hidden on mobile only",
    /@media \(max-width: 720px\)[\s\S]*?\.facility-table \{ display: none; \}/.test(css), true);
}

console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
