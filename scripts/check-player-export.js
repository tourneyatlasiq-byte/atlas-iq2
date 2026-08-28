/**
 * Player export.
 *
 * The file exists so a coach can hand roster information to someone else. That
 * makes two things load-bearing: every value gets its own column (a recipient
 * can delete a column, but cannot reliably split a concatenated cell back
 * apart), and two exports of unchanged data produce identical files (otherwise
 * a recipient diffing them sees noise that is not there).
 *
 * Run:  node scripts/check-player-export.js
 */
const path = require("path");
const { pathToFileURL } = require("url");
const load = (f) => import(pathToFileURL(path.resolve(f)).href);

let passed = 0;
const failures = [];
function ok(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = expected === undefined ? JSON.stringify(true) : JSON.stringify(expected);
  if (a === e) { passed += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}\n          got ${a}\n          want ${e}`); }
}
const section = (t) => console.log(`\n${t}\n`);

(async () => {
const {
  formatPlayerAddress, hasPlayerAddress, orderedContacts,
  exportColumns, exportRow, buildExport, exportFilename,
} = await load("lib/player-export.js");

/* ------------------------------------------------------------- fixtures */
const member = (over = {}) => ({
  id: `a-${over.key ?? "x"}`,
  jersey_number: 4, jersey_size: "AM", pants_size: "YL",
  positions: ["C", "RF"], is_active: true, joined_at: "2026-03-01T00:00:00Z",
  player: {
    full_name: "Bella Ramos", legal_first_name: "Isabella",
    preferred_first_name: "Bella", last_name: "Ramos",
    person_type: "player", other_role_label: null,
    grad_year: 2029, date_of_birth: "2010-06-14", high_school: "Northgate High",
    throws: "R", bats: "L",
    player_email: "bella@example.invalid", player_phone: "(770) 555-0102",
    street_address: "12 Oak Lane", street_address_2: "Apt 4B",
    city: "Cumming", state: "GA", zip: "30040",
    notes: "Left-handed slapper",
    ...(over.player ?? {}),
  },
  contacts: over.contacts ?? [],
  links: over.links ?? [],
  colleges: over.colleges ?? [],
});

const contact = (n, over = {}) => ({
  id: `c${n}`, full_name: `Contact ${n}`, relationship: "Mother",
  email: `c${n}@example.invalid`, phone: `(770) 555-000${n}`,
  preferred_method: "text", is_primary: false, sort_order: n,
  created_at: `2026-01-0${n}T00:00:00Z`, ...over,
});

/* ---------------------------------------------------------- address */
section("Address formatting");

ok("a complete address reads like an envelope",
  formatPlayerAddress({ street_address: "12 Oak Lane", street_address_2: "Apt 4B",
    city: "Cumming", state: "GA", zip: "30040" }),
  "12 Oak Lane, Apt 4B · Cumming, GA 30040");
ok("a partial address omits what is missing",
  formatPlayerAddress({ city: "Cumming", state: "GA" }), "Cumming, GA");
ok("line 1 alone is fine", formatPlayerAddress({ street_address: "12 Oak Lane" }), "12 Oak Lane");
ok("a zip alone is fine", formatPlayerAddress({ zip: "30040" }), "30040");
ok("no address returns null, so the drawer can hide the row",
  formatPlayerAddress({}), null);
ok("hasPlayerAddress is false when empty", hasPlayerAddress({}), false);
ok("...and true on any single part", hasPlayerAddress({ zip: "30040" }), true);

/* --------------------------------------------------------- ordering */
section("Contacts are ordered deterministically");

{
  const shuffled = [
    contact(3, { sort_order: 2, created_at: "2026-01-03T00:00:00Z" }),
    contact(1, { is_primary: true, sort_order: 5 }),
    contact(2, { sort_order: 1 }),
  ];
  ok("primary comes first regardless of sort order",
    orderedContacts(shuffled).map((c) => c.id), ["c1", "c2", "c3"]);
  ok("the same input always gives the same order",
    JSON.stringify(orderedContacts(shuffled)),
    JSON.stringify(orderedContacts([...shuffled].reverse())));
  ok("an empty list is safe", orderedContacts([]), []);
  ok("undefined is safe", orderedContacts(undefined), []);
}

/* ------------------------------------------------------ column model */
section("Columns");

{
  const { columns, contactGroups } = exportColumns([member()]);

  ok("two contact groups even when nobody has any", contactGroups, 2);
  // Coach-facing, not a schema dump: Role Label and Joined Date are internal
  // detail and were removed.
  ok("identity comes first", columns.slice(0, 5),
    ["Full Name", "Legal First Name", "Preferred First Name", "Last Name", "Type"]);
  ok("then team and season", columns.slice(5, 10),
    ["Jersey Number", "Positions", "Jersey Size", "Pants Size", "Status"]);
  ok("no internal role label", columns.includes("Role Label"), false);
  ok("no internal joined date", columns.includes("Joined Date"), false);
  ok("then player details", columns.slice(10, 17),
    ["Grad Year", "Date of Birth", "High School", "Throws", "Bats",
     "Player Email", "Player Phone"]);
  ok("then address", columns.slice(17, 22),
    ["Address Line 1", "Address Line 2", "City", "State", "ZIP"]);
  ok("then notes", columns[22], "Notes");
  ok("then contacts, one column per value", columns.slice(23, 29),
    ["Contact 1 Name", "Contact 1 Relationship", "Contact 1 Email",
     "Contact 1 Phone", "Contact 1 Preferred Method", "Contact 1 Primary"]);
  ok("recruiting last", columns.slice(-4),
    ["X Handle", "X URL", "College Interest 1", "College Interest 1 Notes"]);

  ok("no internal ids are exported",
    columns.some((c) => /\bid\b/i.test(c)), false);
  ok("no legacy parent columns", columns.some((c) => /parent/i.test(c)), false);
  ok("no archive metadata", columns.some((c) => /archiv/i.test(c)), false);
  ok("no row timestamps", columns.some((c) => /created|updated/i.test(c)), false);
  ok("every column name is unique", new Set(columns).size, columns.length);
}

section("Contact groups expand for the widest player");

{
  const rows = [
    member({ key: "a", contacts: [contact(1, { is_primary: true })] }),
    member({ key: "b", contacts: [contact(1), contact(2), contact(3), contact(4)] }),
  ];
  const { contactGroups, columns } = exportColumns(rows);
  ok("four contacts produce four groups", contactGroups, 4);
  ok("...and the header names all four",
    columns.filter((c) => /^Contact \d Name$/.test(c)).length, 4);
  ok("nobody is truncated",
    exportRow(rows[1], exportColumns(rows)).filter((v) => v === "Contact 4").length, 1);
}

/* ------------------------------------------------------------- rows */
section("Row values");

{
  const rows = [member({ contacts: [contact(1, { is_primary: true }), contact(2)],
                         links: [{ label: "@bellaramos", url: "https://x.com/bellaramos" }],
                         colleges: [{ college_name: "Georgia Tech", notes: "Camp in June" }] })];
  const { columns, rows: body } = buildExport(rows);
  const r = body[0];
  const at = (name) => r[columns.indexOf(name)];

  ok("the row is exactly as wide as the header", r.length, columns.length);
  ok("full name", at("Full Name"), "Bella Ramos");
  ok("structured names survive", [at("Legal First Name"), at("Preferred First Name"), at("Last Name")],
    ["Isabella", "Bella", "Ramos"]);
  ok("type is human readable, not the enum", at("Type"), "Player");
  ok("positions are joined the way the drawer and the importer both read them",
    at("Positions"), "C / RF");
  ok("status is a word", at("Status"), "Active");
  ok("date of birth is ISO", at("Date of Birth"), "2010-06-14");
  ok("address is split across its own columns",
    [at("Address Line 1"), at("Address Line 2"), at("City"), at("State"), at("ZIP")],
    ["12 Oak Lane", "Apt 4B", "Cumming", "GA", "30040"]);
  ok("the ZIP stays a string so a leading zero would survive",
    typeof at("ZIP"), "string");
  ok("the phone stays a string", typeof at("Player Phone"), "string");

  ok("the primary contact is contact 1", at("Contact 1 Name"), "Contact 1");
  ok("...and is marked", at("Contact 1 Primary"), "Yes");
  ok("the second contact is not marked primary", at("Contact 2 Primary"), "");
  ok("contact values are in separate columns, never concatenated",
    [at("Contact 1 Relationship"), at("Contact 1 Email"), at("Contact 1 Phone"),
     at("Contact 1 Preferred Method")],
    ["Mother", "c1@example.invalid", "(770) 555-0001", "text"]);
  ok("no cell contains a joined contact record",
    r.some((v) => typeof v === "string" && v.includes("@") && v.includes(",")), false);

  ok("the X handle is the coach's own text", at("X Handle"), "@bellaramos");
  ok("...with the resolved URL beside it", at("X URL"), "https://x.com/bellaramos");
  ok("college interest and its notes are separate",
    [at("College Interest 1"), at("College Interest 1 Notes")],
    ["Georgia Tech", "Camp in June"]);
}

section("Sparse and awkward records");

{
  const cases = [
    ["no address", member({ player: { street_address: null, street_address_2: null,
        city: null, state: null, zip: null } })],
    ["partial address", member({ player: { street_address: "9 Elm", street_address_2: null,
        city: null, state: "GA", zip: null } })],
    ["zero contacts", member({ contacts: [] })],
    ["one contact", member({ contacts: [contact(1, { is_primary: true })] })],
    ["no X link", member({ links: [] })],
    ["no college interests", member({ colleges: [] })],
    ["inactive member", { ...member(), is_active: false }],
    ["staff record", member({ player: { person_type: "coach",
        other_role_label: "Assistant Coach", grad_year: null, date_of_birth: null } })],
    ["everything empty", { id: "z", positions: [], player: { full_name: "Bare Minimum" },
        contacts: [], links: [], colleges: [] }],
  ];

  for (const [label, row] of cases) {
    const { columns, rows: body } = buildExport([row]);
    ok(`${label}: row width matches the header`, body[0].length, columns.length);
    ok(`${label}: every cell is a string`,
      body[0].every((v) => typeof v === "string"), true);
    ok(`${label}: nothing is null or undefined`,
      body[0].some((v) => v === null || v === undefined), false);
  }

  const inactive = buildExport([{ ...member(), is_active: false }]);
  ok("an inactive member is exported and labelled",
    inactive.rows[0][inactive.columns.indexOf("Status")], "Inactive");

  const staff = buildExport([member({ player: { person_type: "coach",
    other_role_label: "Assistant Coach" } })]);
  ok("staff are identified by type", staff.rows[0][staff.columns.indexOf("Type")], "Coach");
}

section("Characters that break spreadsheets");

{
  const nasty = member({ player: {
    full_name: 'O\u2019Brien, "Katie" <test>',
    notes: "Line one\nline two\ttabbed; semi, comma",
    street_address: "12 Oak Lane #3 & 4",
    city: "Ni\u00f1o Valley",
  }, contacts: [contact(1, { full_name: "Mar\u00eda Jos\u00e9", is_primary: true })] });

  const { columns, rows: body } = buildExport([nasty]);
  const at = (n) => body[0][columns.indexOf(n)];
  ok("an apostrophe and quotes survive verbatim", at("Full Name"), 'O\u2019Brien, "Katie" <test>');
  ok("accents survive", at("City"), "Ni\u00f1o Valley");
  ok("an ampersand survives", at("Address Line 1"), "12 Oak Lane #3 & 4");
  ok("newlines and tabs are preserved, not stripped",
    at("Notes"), "Line one\nline two\ttabbed; semi, comma");
  ok("a non-ASCII contact name survives", at("Contact 1 Name"), "Mar\u00eda Jos\u00e9");
}

section("Determinism and filename");

{
  const rows = [member({ key: "a", contacts: [contact(2), contact(1, { is_primary: true })] }),
                member({ key: "b" })];
  ok("two builds of the same data are byte-identical",
    JSON.stringify(buildExport(rows)), JSON.stringify(buildExport(rows)));

  ok("the filename names the team and season",
    exportFilename("Armor Elite", "2026-27"), "Armor Elite 2026-27 Players");
  ok("path-hostile characters are removed",
    exportFilename("A/B:C", "2026"), "A-B-C 2026 Players");
  ok("a missing team name still produces something usable",
    exportFilename(null, "2026-27"), "2026-27 Players");
  ok("the filename carries no personal data",
    /Ramos|Bella|@/.test(exportFilename("Armor Elite", "2026-27")), false);
}

console.log(`\n${passed} assertions, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
})();
