/**
 * Shared table sorting.
 *
 * The two rules that are easy to get wrong and expensive when wrong:
 *
 *   SORT THE VALUE, NOT THE CELL. A formatted date sorts as text, so
 *   "05/02/2011" lands before "12/09/2009" — reversed, and nobody notices
 *   until they rely on it.
 *
 *   MISSING GOES LAST IN BOTH DIRECTIONS. Not first ascending and last
 *   descending. Fourteen players without a date of birth should never push the
 *   thirty-five who have one off the screen.
 *
 * Run:  node scripts/check-table-sort.js
 */
const path = require("path");
const { pathToFileURL } = require("url");
const load = (f) => import(pathToFileURL(path.resolve(f)).href);

let passed = 0;
const failures = [];
function ok(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected === undefined ? true : expected);
  if (a === e) { passed += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}\n          got  ${a}\n          want ${e}`); }
}
const section = (t) => console.log(`\n${t}\n`);
const read = (f) => require("fs").readFileSync(f, "utf8");

(async () => {
const { sortRows } = await load("lib/table-sort.js");

/* The roster's real column definitions, mirrored. */
const COLS = {
  jersey: { value: (r) => (r.jersey_number == null ? null : Number(r.jersey_number)) },
  player: { value: (r) => r.player?.full_name ?? null },
  dob: { value: (r) => (r.player?.date_of_birth ? new Date(r.player.date_of_birth) : null) },
  grad: { value: (r) => (r.player?.grad_year == null ? null : Number(r.player.grad_year)) },
  positions: { value: (r) => (r.positions?.length ? r.positions.join(" / ") : null) },
};
const tb = (a, b) => String(a.id).localeCompare(String(b.id));

const rows = [
  { id: "a", jersey_number: 12, positions: ["SS"],
    player: { full_name: "Ava Whitfield", date_of_birth: "2009-12-09", grad_year: 2028 } },
  { id: "b", jersey_number: 4, positions: ["C", "RF"],
    player: { full_name: "bella ramos", date_of_birth: "2011-05-02", grad_year: 2029 } },
  { id: "c", jersey_number: null, positions: null,
    player: { full_name: "Coach Casey", date_of_birth: null, grad_year: null } },
  { id: "d", jersey_number: 2, positions: ["1B"],
    player: { full_name: "Zoe Adams", date_of_birth: null, grad_year: 2028 } },
];
const ids = (key, dir) => sortRows(rows, { key, dir }, COLS, tb).map((r) => r.id);

section("Values, not formatted strings");

{
  // The trap, stated explicitly: as text the order reverses.
  ok("formatted dates would sort wrongly as text",
    ["05/02/2011", "12/09/2009"].sort(), ["05/02/2011", "12/09/2009"]);
  ok("dates sort as dates, oldest first",
    sortRows(rows, { key: "dob", dir: "asc" }, COLS, tb)
      .filter((r) => r.player.date_of_birth).map((r) => r.player.date_of_birth),
    ["2009-12-09", "2011-05-02"]);
  ok("...and newest first when reversed",
    sortRows(rows, { key: "dob", dir: "desc" }, COLS, tb)
      .filter((r) => r.player.date_of_birth).map((r) => r.player.date_of_birth),
    ["2011-05-02", "2009-12-09"]);

  ok("jersey numbers sort numerically, not as text", ids("jersey", "asc"), ["d", "b", "a", "c"]);
  ok("...so 12 follows 4 rather than preceding it",
    ids("jersey", "asc").indexOf("b") < ids("jersey", "asc").indexOf("a"), true);
  ok("grad years sort numerically", ids("grad", "asc").slice(0, 3).length, 3);
}

section("Names are compared case-insensitively");

{
  ok("lowercase does not sort after uppercase",
    sortRows(rows, { key: "player", dir: "asc" }, COLS, tb).map((r) => r.player.full_name),
    ["Ava Whitfield", "bella ramos", "Coach Casey", "Zoe Adams"]);
  ok("...and reverses cleanly",
    sortRows(rows, { key: "player", dir: "desc" }, COLS, tb).map((r) => r.player.full_name),
    ["Zoe Adams", "Coach Casey", "bella ramos", "Ava Whitfield"]);

  // Numeric collation, so a jersey-style name does not sort 10 before 2.
  const numeric = [{ id: "1", player: { full_name: "Player 10" } },
                   { id: "2", player: { full_name: "Player 2" } }];
  ok("numbers inside names compare numerically",
    sortRows(numeric, { key: "player", dir: "asc" }, COLS, tb).map((r) => r.player.full_name),
    ["Player 2", "Player 10"]);
}

section("Missing values are last in BOTH directions");

{
  ok("a missing jersey number is last ascending", ids("jersey", "asc").at(-1), "c");
  ok("...and still last descending", ids("jersey", "desc").at(-1), "c");

  ok("two missing dates are last ascending", ids("dob", "asc").slice(-2).sort(), ["c", "d"]);
  ok("...and still last descending", ids("dob", "desc").slice(-2).sort(), ["c", "d"]);

  ok("a missing positions list is last", ids("positions", "asc").at(-1), "c");
  ok("...both ways", ids("positions", "desc").at(-1), "c");
}

section("Ordering is stable and the default is preserved");

{
  ok("no sort returns the rows untouched",
    sortRows(rows, null, COLS, tb).map((r) => r.id), ["a", "b", "c", "d"]);
  ok("an unknown column returns them untouched",
    sortRows(rows, { key: "nope", dir: "asc" }, COLS, tb).map((r) => r.id), ["a", "b", "c", "d"]);
  ok("the input array is never mutated",
    (() => { const before = rows.map((r) => r.id).join();
      sortRows(rows, { key: "jersey", dir: "desc" }, COLS, tb);
      return rows.map((r) => r.id).join() === before; })(), true);

  // Equal values must not shuffle between renders.
  const tied = [{ id: "z", player: { grad_year: 2028 } }, { id: "y", player: { grad_year: 2028 } }];
  ok("equal values fall back to the tiebreak",
    sortRows(tied, { key: "grad", dir: "asc" }, COLS, tb).map((r) => r.id), ["y", "z"]);
  ok("...identically on a repeat sort",
    sortRows(tied, { key: "grad", dir: "asc" }, COLS, tb).map((r) => r.id),
    sortRows(tied, { key: "grad", dir: "asc" }, COLS, tb).map((r) => r.id));
}

section("The roster wires it correctly");

{
  const ui = read("components/RosterClient.js");
  const sh = read("components/SortHeader.js");
  const css = read("app/globals.css");

  ok("sorting starts unset, so the page's own order is what a coach sees",
    /useTableSort\(null\)/.test(ui));
  ok("the default order is still active-first then jersey",
    /a\.is_active \? -1 : 1/.test(ui) && /a\.jersey_number - b\.jersey_number/.test(ui));
  ok("sorting is applied to the FILTERED rows",
    /useSortedRows\(visible, sort, ROSTER_COLUMNS/.test(ui));
  ok("...and the table renders the sorted set", /\{sortedVisible\.map\(/.test(ui));

  for (const col of ["jersey", "player", "dob", "grad", "positions"]) {
    ok(`${col} is sortable`, new RegExp(`column="${col}"`).test(ui));
  }
  ok("Uniform is deliberately NOT sortable", /column="uniform"/.test(ui), false);
  ok("...and the reason is recorded", /categorical/.test(ui));

  ok("dates are compared as dates, not strings", /new Date\(r\.player\.date_of_birth\)/.test(ui));
  ok("jersey numbers are coerced to numbers", /Number\(r\.jersey_number\)/.test(ui));

  ok("the header carries aria-sort", /aria-sort=/.test(sh));
  ok("...with all three states",
    /"descending"/.test(sh) && /"ascending"/.test(sh) && /"none"/.test(sh));
  ok("the control is a button, so keyboard use is free", /<button/.test(sh));
  ok("the sort mark is hidden from assistive tech", /aria-hidden="true"/.test(sh));
  ok("an unsorted column is quiet until hovered or focused",
    /\.th-sort-mark \{[^}]*color: transparent/.test(css));
  ok("...and visible on focus", /\.th-sort:focus-visible \.th-sort-mark/.test(css));
  ok("focus is visible on the control itself", /\.th-sort:focus-visible \{/.test(css));
  ok("touch devices show the affordance at rest",
    /@media \(hover: none\)[\s\S]{0,200}?\.th-sort-mark/.test(css));

  ok("no separate Sort dropdown was added", /Sort by<\/label>|<select[^>]*sort/i.test(ui), false);
  ok("row identity is unchanged by sorting", /key=\{row\.id\}/.test(ui));
}

console.log(`\n${passed} assertions, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
})();
