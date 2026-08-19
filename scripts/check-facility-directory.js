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

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
