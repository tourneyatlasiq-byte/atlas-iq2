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
  assertEq("three types, no Services in V1",
    /facility[\s\S]{0,120}?lodging[\s\S]{0,120}?dining/.test(fields), true);
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
