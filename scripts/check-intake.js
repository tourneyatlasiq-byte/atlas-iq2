/**
 * Player Intake — A1 through A8.
 *
 * The fixture reproduces the Armor Elite JotForm HEADER STRUCTURE exactly, so
 * the real export format is proven mappable. Every VALUE is synthetic. No
 * player or parent PII from the real export is committed here — these are
 * minors' names, birth dates, emails and phone numbers, and a test fixture is
 * the wrong place for them.
 *
 * Run:  node scripts/check-intake.js
 */
const { pathToFileURL } = require("url");
const path = require("path");

let failures = 0, ran = 0;
const load = (f) => import(pathToFileURL(path.resolve(f)).href);

function ok(label, actual, expected) {
  ran += 1;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
  } else console.log(`  ok    ${label}`);
}
function truthy(label, v) { ok(label, Boolean(v), true); }

/* The 30 real JotForm headers, verbatim. Values are invented. */
const JOTFORM_HEADERS = [
  "Submission Date", "Legal First Name", "Preferred First Name", "Last Name",
  "Jersey Number", "Alternate Jersey Number", "Graduation Year", "Date of Birth",
  "Primary Position", "Secondary Position", "Bats", "Throws", "Height",
  "High School", "Hometown", "Parent/Guardian 1 Full Name", "Relationship to Player",
  "Cell Phone", "Email", "Add a second parent/guardian?", "Parent/Guardian 2 Full Name",
  "Relationship to Player (2)", "Cell Phone (2)", "Email (2)",
  "Preferred contact method", "Player Email", "Player Cell", "X handle",
  "Current Headshot", "Current Action Photo",
];

(async () => {
  const reg = await load("lib/intake/registry.js");
  const nrm = await load("lib/intake/normalize.js");
  const mat = await load("lib/intake/match.js");
  const res = await load("lib/intake/resolve.js");
  const pln = await load("lib/intake/plan.js");
  const map = await load("lib/intake/map-headers.js");

  console.log("\nPlayer Intake — A1 to A8\n");

  /* ---- A1 registry ----------------------------------------------------- */
  console.log("A1 registry");
  const attrs = ["key","label","level","type","category","sensitive",
                 "requiredByProduct","requiredForIntake","importable",
                 "collectable","destination","synonyms"];
  const missing = reg.FIELDS.filter((f) => attrs.some((a) => f[a] === undefined));
  ok("every field carries all 12 attributes", missing.map((f) => f.key), []);
  ok("no duplicate keys", reg.FIELDS.length, new Set(reg.FIELDS.map((f) => f.key)).size);
  ok("only full_name is required by the product",
    reg.FIELDS.filter((f) => f.requiredByProduct).map((f) => f.key), ["full_name"]);
  ok("only full_name is required for intake",
    reg.FIELDS.filter((f) => f.requiredForIntake).map((f) => f.key), ["full_name"]);
  ok("DOB is sensitive and not required", 
    [reg.BY_KEY.get("date_of_birth").sensitive, reg.BY_KEY.get("date_of_birth").requiredForIntake],
    [true, false]);
  ok("levels are valid",
    reg.FIELDS.filter((f) => !reg.LEVELS.includes(f.level)).map((f) => f.key), []);
  ok("pending-migration fields are exactly the new columns",
    reg.pendingFields().map((f) => f.key).sort(),
    ["contact_email","contact_name","contact_phone","contact_preferred","contact_relationship",
     "high_school","last_name","legal_first_name","preferred_first_name"]);

  /* ---- A3 normalisers -------------------------------------------------- */
  console.log("\nA3 normalisers");
  ok("email lowercased and trimmed", nrm.normEmail("  Aubs.4488@Gmail.COM "), "aubs.4488@gmail.com");
  ok("phone to ten digits", nrm.normPhone("(470) 302-6999"), "4703026999");
  ok("leading US 1 dropped", nrm.normPhone("1-470-302-6999"), "4703026999");
  ok("partial phone is not an identifier", nrm.normPhone("302-6999"), null);
  ok("name comparison strips punctuation and case", nrm.normName("O'Brien-Smith, Ana"), "o brien smith ana");
  ok("ISO date passes through", nrm.toDate("2010-04-03"), "2010-04-03");
  ok("named month is unambiguous", nrm.toDate("Apr 3, 2010"), "2010-04-03");
  ok("AMBIGUOUS numeric date is rejected, not guessed", nrm.toDate("03/04/2010"), null);
  ok("spoken positions become codes", nrm.toPositions("Utility; Second Base"), ["UTIL","2B"]);
  ok("codes pass through", nrm.toPositions("SS, CF"), ["SS","CF"]);
  ok("unknown position dropped", nrm.toPositions("Designated Hitter"), []);

  /* ---- A4 composeFullName --------------------------------------------- */
  console.log("\nA4 composeFullName");
  ok("preferred beats legal",
    nrm.composeFullName({ legal_first_name:"Aubrey", preferred_first_name:"Aubs", last_name:"Rivers" }),
    "Aubs Rivers");
  ok("legal used when no preferred",
    nrm.composeFullName({ legal_first_name:"Aubrey", last_name:"Rivers" }), "Aubrey Rivers");
  ok("LEGACY record is never forced into structured names",
    nrm.composeFullName({ full_name:"Jordan Vale" }), "Jordan Vale");
  ok("partial structure falls back to legacy full_name",
    nrm.composeFullName({ legal_first_name:"Aubrey", full_name:"Aubrey Rivers" }), "Aubrey Rivers");
  ok("invariant holds for a derived record",
    nrm.nameIsConsistent({ preferred_first_name:"Aubs", last_name:"Rivers", full_name:"Aubs Rivers" }), true);
  ok("invariant catches divergence",
    nrm.nameIsConsistent({ preferred_first_name:"Aubs", last_name:"Rivers", full_name:"Someone Else" }), false);

  /* ---- A5 player matching ---------------------------------------------- */
  console.log("\nA5 player matching");
  const existing = [
    { id:"p1", full_name:"Aubs Rivers", grad_year:2028, date_of_birth:"2010-04-03",
      legal_first_name:"Aubrey", preferred_first_name:"Aubs", last_name:"Rivers",
      contacts:[{ full_name:"Rae Rivers", email:"rae@example.test", phone:"4045550111" }] },
    { id:"p2", full_name:"Ana Cole", grad_year:2029 },
    { id:"p3", full_name:"Sam Reed", grad_year:2028 },
    { id:"p4", full_name:"Sam Reed", grad_year:2030 },
  ];
  const M = mat.CLASS;

  ok("name + DOB + grad agree -> CONFIDENT",
    mat.matchPlayer({ full_name:"Aubs Rivers", date_of_birth:"2010-04-03", grad_year:2028 }, existing).classification,
    M.CONFIDENT);
  ok("contact email corroborates -> CONFIDENT",
    mat.matchPlayer({ full_name:"Aubs Rivers", contacts:[{ email:"RAE@example.test" }] }, existing).classification,
    M.CONFIDENT);
  ok("name only -> POSSIBLE",
    mat.matchPlayer({ full_name:"Ana Cole" }, existing).classification, M.POSSIBLE);
  ok("CONFLICTING grad year is CONFLICT, never NEW",
    mat.matchPlayer({ full_name:"Aubs Rivers", grad_year:2027 }, existing).classification, M.CONFLICT);
  ok("CONFLICTING DOB is CONFLICT, never NEW",
    mat.matchPlayer({ full_name:"Aubs Rivers", date_of_birth:"2011-01-01" }, existing).classification, M.CONFLICT);
  ok("conflicting contact email is CONFLICT",
    mat.matchPlayer({ full_name:"Aubs Rivers", contacts:[{ email:"other@example.test" }] }, existing).classification,
    M.CONFLICT);
  ok("two namesakes -> POSSIBLE, no candidate chosen",
    mat.matchPlayer({ full_name:"Sam Reed" }, existing).candidate, null);
  ok("unknown name -> NEW",
    mat.matchPlayer({ full_name:"Nia Frost" }, existing).classification, M.NEW);
  ok("no name -> INVALID",
    mat.matchPlayer({ full_name:"" }, existing).classification, M.INVALID);
  ok("legal-name variant matches the preferred-name record",
    mat.matchPlayer({ full_name:"Aubrey Rivers", grad_year:2028 }, existing).classification, M.CONFIDENT);
  ok("JERSEY NUMBER is never an identity input",
    mat.matchPlayer({ full_name:"Nia Frost", jersey_number:44 }, existing).classification, M.NEW);

  /* ---- A6 contact matching --------------------------------------------- */
  console.log("\nA6 contact matching");
  const cs = [
    { id:"c1", full_name:"Rae Rivers", email:"rae@example.test", phone:"4045550111" },
    { id:"c2", full_name:"Dana Rivers", phone:"4045550111" },
  ];
  const C = mat.CONTACT;
  ok("email match updates", mat.matchContact({ email:"RAE@example.test " }, cs).action, C.UPDATE);
  ok("phone + compatible name updates",
    mat.matchContact({ full_name:"Rae Rivers", phone:"(404) 555-0111" }, cs).action, C.UPDATE);
  ok("PHONE ALONE never updates silently",
    mat.matchContact({ phone:"(404) 555-0111" }, cs).action, C.REVIEW);
  ok("phone with a different name goes to review",
    mat.matchContact({ full_name:"Chris Vale", phone:"4045550111" }, cs).action, C.REVIEW);
  ok("name alone goes to review",
    mat.matchContact({ full_name:"Rae Rivers" }, cs).action, C.REVIEW);
  ok("nothing matches -> insert",
    mat.matchContact({ full_name:"New Person", email:"new@example.test" }, cs).action, C.INSERT);

  /* ---- A7 resolver ------------------------------------------------------ */
  console.log("\nA7 conflict resolution");
  const d = res.diffRecord(
    { grad_year:2028, bats:null, player_email:"a@example.test", throws:"Right" },
    { grad_year:2027, bats:"Left", player_email:null, throws:"Right" }
  );
  ok("blank import NEVER erases a populated value",
    d.entries.find((e) => e.key === "bats").status, res.DIFF.KEEP);
  ok("blank existing + value = FILL",
    d.fills.map((e) => e.key), ["player_email"]);
  ok("equal values = SAME",
    d.entries.find((e) => e.key === "throws").status, res.DIFF.SAME);
  ok("both populated and different = CONFLICT",
    d.conflicts.map((e) => e.key), ["grad_year"]);
  ok("an undecided conflict contributes nothing",
    res.applyDecisions(d, {}).undecided, ["grad_year"]);
  ok("choosing existing writes nothing for that field",
    Object.keys(res.applyDecisions(d, { grad_year:"existing" }).values), ["player_email"]);
  ok("choosing incoming writes it",
    res.applyDecisions(d, { grad_year:"incoming" }).values.grad_year, 2028);

  /* ---- A8 planner ------------------------------------------------------- */
  console.log("\nA8 write plan");
  const newRow = { full_name:"Nia Frost", grad_year:2029, jersey_number:12,
                   positions:["SS"], bats:"Right", contacts:[] };
  const newPlan = pln.buildRowPlan({
    row:newRow, match:mat.matchPlayer(newRow, existing), existingPlayer:null });
  ok("new player -> players insert + membership insert",
    newPlan.writes.map((w) => `${w.table}:${w.op}`), ["players:insert","team_season_players:insert"]);
  ok("season values route to the membership, never the player",
    Object.keys(newPlan.writes[1].values).sort(), ["jersey_number","positions"]);
  ok("player values route to the player, never the membership",
    Object.keys(newPlan.writes[0].values).sort(), ["bats","full_name","grad_year"]);
  truthy("a clean new-player plan is executable", newPlan.executable);

  const fillRow = { full_name:"Ana Cole", grad_year:2029, player_email:"ana@example.test",
                    jersey_number:7, contacts:[] };
  const fillMatch = { classification: M.CONFIDENT, candidate: existing[1], reasons:["grad year agrees"] };
  const fillPlan = pln.buildRowPlan({
    row:fillRow, match:fillMatch, existingPlayer:existing[1] });
  ok("existing player -> update + upsert",
    fillPlan.writes.map((w) => `${w.table}:${w.op}`), ["players:update","team_season_players:upsert"]);
  ok("only the missing field is filled",
    Object.keys(fillPlan.writes[0].values), ["player_email"]);
  truthy("a fill-only plan is executable", fillPlan.executable);

  const conflictRow = { full_name:"Aubs Rivers", grad_year:2027, contacts:[] };
  const conflictPlan = pln.buildRowPlan({
    row:conflictRow, match:mat.matchPlayer(conflictRow, existing), existingPlayer:existing[0] });
  ok("a CONFLICT row produces no executable write", conflictPlan.executable, false);
  truthy("and says why", conflictPlan.blockers.length > 0);

  const pendingRow = { full_name:"Nia Frost", last_name:"Frost", legal_first_name:"Nia", contacts:[] };
  const pendingPlan = pln.buildRowPlan({
    row:pendingRow, match:{ classification:M.NEW, candidate:null, reasons:[] }, existingPlayer:null });
  ok("PENDING MIGRATION makes a plan non-executable", pendingPlan.executable, false);
  truthy("and names the fields", pendingPlan.pending.length > 0);

  const contactRow = { full_name:"Nia Frost",
    contacts:[{ full_name:"Kit Frost", email:"kit@example.test" }] };
  const contactPlan = pln.buildRowPlan({
    row:contactRow, match:{ classification:M.NEW, candidate:null, reasons:[] }, existingPlayer:null });
  ok("contacts are planned but blocked pending migration", contactPlan.executable, false);
  truthy("player_contacts appears in the plan",
    contactPlan.writes.some((w) => w.table === "player_contacts"));

  /* ---- A8 prohibition --------------------------------------------------- */
  console.log("\nA8 prohibition");
  const allPlans = [newPlan, fillPlan, conflictPlan, pendingPlan, contactPlan];
  const tables = [...new Set(allPlans.flatMap((p) => p.writes.map((w) => w.table)))].sort();
  ok("only three tables are ever written",
    tables, ["player_contacts","players","team_season_players"]);
  ok("no forbidden table appears in any plan",
    allPlans.flatMap((p) => p.writes.map((w) => w.table))
            .filter((t) => pln.FORBIDDEN_TABLES.includes(t)), []);

  for (const t of ["player_payments","tournament_participants","profiles","player_guardians",
                   "invites","documents","plate_appearances","payment_log"]) {
    let threw = false;
    try { pln.assertPlanSafe({ writes:[{ table:t, values:{} }], pending:[] }); }
    catch { threw = true; }
    ok(`a plan naming ${t} throws`, threw, true);
  }

  /* ---- A2 header mapping ------------------------------------------------ */
  console.log("\nA2 JotForm header mapping");
  const sug = map.suggestMappings(JOTFORM_HEADERS);
  const accounted = sug.mappings.length + sug.ignored.length;
  ok("all 30 headers resolve to a field or an intentional ignore",
    [accounted, sug.unmapped], [30, []]);
  ok("contact groups discovered generically, not hard-coded",
    sug.contactGroups, [1, 2]);
  ok("DOB is recognised but NOT auto-enabled",
    sug.mappings.find((m) => m.key === "date_of_birth").autoEnabled, false);
  ok("DOB is the ONLY field requiring an opt-in click",
    sug.mappings.filter((m) => m.optIn).map((m) => m.key), ["date_of_birth"]);
  ok("photos are ignored, not mapped",
    sug.ignored.filter((i) => i.key.includes("photo") || i.key.includes("headshot")).length, 2);
  ok("both position columns map to the season field",
    sug.mappings.filter((m) => m.key === "positions").length, 2);
  ok("guardian 2 columns carry index 2",
    sug.mappings.filter((m) => m.index === 2).map((m) => m.key).sort(),
    ["contact_email","contact_name","contact_phone","contact_relationship"]);
  ok("player email is player-level, guardian email is contact-level",
    [sug.mappings.find((m) => m.header === "Player Email").level,
     sug.mappings.find((m) => m.header === "Email").level], ["player","contact"]);

  // A four-guardian file maps just as readily.
  const four = map.suggestMappings([
    "Name","Guardian 1 Email","Guardian 2 Email","Guardian 3 Email","Guardian 4 Email"]);
  ok("a four-contact file is handled generically", four.contactGroups, [1,2,3,4]);

  // The minimal spreadsheet a coach might build by hand.
  const tiny = map.suggestMappings(["Player","#","Grad Year","Position","Parent","Email"]);
  ok("a six-column hand-made sheet maps", tiny.unmapped, []);
  ok("...to the right fields",
    tiny.mappings.map((m) => m.key).sort(),
    ["contact_email","contact_name","full_name","grad_year","jersey_number","positions"]);

  const applied = map.applyMappings(
    { "Legal First Name":"Nia", "Last Name":"Frost", "Jersey Number":"12",
      "Primary Position":"Utility", "Secondary Position":"Second Base",
      "Parent/Guardian 1 Full Name":"Kit Frost", "Email":"kit@example.test",
      "Cell Phone":"(404) 555-0199", "Parent/Guardian 2 Full Name":"Ari Frost",
      "Email (2)":"ari@example.test" },
    sug.mappings);
  ok("two contact groups extracted", applied.contacts.length, 2);
  ok("positions accumulate across both columns",
    nrm.toPositions(applied.positions), ["UTIL","2B"]);


  /* ---- End-to-end: the two files a coach actually has -------------------
     Full pipeline — headers to write plan — on synthetic data with the real
     30-column structure, and on a six-column sheet someone typed by hand. */
  console.log("\nEnd to end");

  const { normalizeValue } = nrm;
  const { BY_KEY, isIgnored } = reg;

  function runFile(headers, rows, existingPlayers = [], { includeSensitive = false } = {}) {
    const sug = map.suggestMappings(headers);
    const active = sug.mappings.filter((m) => m.autoEnabled || (includeSensitive && m.sensitive));
    return rows.map((cells) => {
      const raw = Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
      const mapped = map.applyMappings(raw, active);
      const row = { contacts: [] };
      for (const [k, v] of Object.entries(mapped)) {
        if (k === "contacts") continue;
        const field = BY_KEY.get(k);
        if (!field || isIgnored(k)) continue;
        row[k] = normalizeValue(field.type, v);
      }
      if (!row.full_name) row.full_name = nrm.composeFullName(row);
      row.contacts = mapped.contacts ?? [];
      const m2 = mat.matchPlayer(row, existingPlayers);
      return { row, match: m2, plan: pln.buildRowPlan({
        row, match: m2, existingPlayer: m2.candidate ?? null }) };
    });
  }

  // Synthetic values, real structure. No PII from the actual export.
  const jf = runFile(JOTFORM_HEADERS, [[
    "Aug 20, 2026","Wren","Wrenny","Calder","44","11","2028","Apr 3, 2010",
    "Utility","Second Base","Right","Right","5'8","North Ridge","Elmton",
    "Robin Calder","Mother","(470) 555-0101","robin@example.test","Yes",
    "Alex Calder","Father","(470) 555-0102","alex@example.test",
    "Text","wren@example.test","(470) 555-0103","wrenny_88",
    "https://example.test/u/1","https://example.test/u/2",
  ]]);

  ok("JotForm row resolves a player name", jf[0].row.full_name, "Wrenny Calder");
  ok("both guardians captured generically", jf[0].row.contacts.length, 2);
  ok("positions normalised to season codes", jf[0].row.positions, ["UTIL","2B"]);
  ok("DOB omitted unless the coach opts in", jf[0].row.date_of_birth, undefined);
  ok("JotForm row is NOT executable (structured names + contacts pending)",
    jf[0].plan.executable, false);
  ok("only permitted tables appear",
    [...new Set(jf[0].plan.writes.map((w) => w.table))].sort(),
    ["player_contacts","players","team_season_players"]);

  const jfDob = runFile(JOTFORM_HEADERS, [[
    "Aug 20, 2026","Wren","Wrenny","Calder","44","","2028","Apr 3, 2010",
    "Utility","","Right","Right","","","","","","","","No","","","","","",
    "","","","",""]], [], { includeSensitive: true });
  ok("opting in imports the date of birth", jfDob[0].row.date_of_birth, "2010-04-03");

  // The six-column sheet a coach types themselves.
  const SIMPLE = ["Player","#","Grad Year","Position","Parent","Email"];
  const simple = runFile(SIMPLE, [
    ["Wrenny Calder","44","2028","Shortstop","Robin Calder","robin@example.test"],
    ["Ada Nkemelu","7","2029","Catcher","Sam Nkemelu","sam@example.test"],
  ]);

  ok("simple sheet: every column mapped", map.suggestMappings(SIMPLE).unmapped, []);
  ok("simple sheet: nothing requires an opt-in click",
    map.suggestMappings(SIMPLE).mappings.filter((m) => m.optIn), []);
  ok("simple sheet: the parent email is labelled sensitive but still included",
    map.suggestMappings(SIMPLE).mappings.find((m) => m.key === "contact_email").autoEnabled, true);
  ok("simple sheet: player names resolve",
    simple.map((r) => r.row.full_name), ["Wrenny Calder","Ada Nkemelu"]);
  ok("simple sheet: positions normalised", simple[0].row.positions, ["SS"]);
  ok("simple sheet: both rows are NEW", simple.map((r) => r.match.classification), ["new","new"]);
  ok("simple sheet is blocked ONLY by the contact column",
    simple[0].plan.pending, ["contact_*"]);

  // Without a parent column there is nothing pending: fully executable today.
  const minimal = runFile(["Player","#","Grad Year","Position"],
    [["Wrenny Calder","44","2028","Shortstop"]]);
  ok("a name/number/year/position sheet is executable TODAY",
    minimal[0].plan.executable, true);
  ok("...writing only the player and the membership",
    minimal[0].plan.writes.map((w) => w.table), ["players","team_season_players"]);

  // Existing player: gaps filled, nothing overwritten.
  const known = [{ id:"e1", full_name:"Ada Nkemelu", grad_year:2029 }];
  const second = runFile(["Player","#","Grad Year","Position"],
    [["Ada Nkemelu","7","2029","Catcher"]], known);
  ok("a known player is matched, not duplicated", second[0].match.classification, "confident");
  ok("only the season record changes when the player is complete",
    second[0].plan.writes.filter((w) => Object.keys(w.values).length).map((w) => w.table),
    ["team_season_players"]);


  /* ---- Registry integrity after the optIn split ------------------------- */
  console.log("\nRegistry integrity");

  ok("optIn is declared on every field",
    reg.FIELDS.filter((f) => f.optIn === undefined).map((f) => f.key), []);
  ok("DOB is the only optIn field",
    reg.FIELDS.filter((f) => f.optIn).map((f) => f.key), ["date_of_birth"]);
  ok("sensitive is broader than optIn, and still labels contact fields",
    reg.FIELDS.filter((f) => f.sensitive).map((f) => f.key).sort(),
    ["contact_email","contact_phone","date_of_birth","player_email","player_phone"]);
  ok("a sensitive field that is not optIn still auto-enables",
    map.suggestMappings(["Parent Email"]).mappings[0].autoEnabled, true);
  ok("...and is still flagged sensitive so it can be disclosed",
    map.suggestMappings(["Parent Email"]).mappings[0].sensitive, true);
  ok("the review step can still name every sensitive column",
    map.suggestMappings(JOTFORM_HEADERS).sensitive.length > 0, true);

  /* ---- Nothing writable is pending, nothing pending is writable --------- */
  ok("writable fields never carry a pending destination",
    reg.writableFields().filter((f) => f.pendingMigration).map((f) => f.key), []);
  ok("every pending field names a destination it cannot use yet",
    reg.pendingFields().filter((f) => !f.destination).map((f) => f.key), []);

  /* ---- A plan with pending fields can never be executable ---------------- */
  let escaped = false;
  try {
    pln.assertPlanSafe({ writes: [{ table: "players", values: {} }],
                         pending: ["last_name"], executable: true });
    escaped = true;
  } catch { /* expected */ }
  ok("a pending plan claiming to be executable throws", escaped, false);

  /* ---- 30 JotForm columns after the optIn change ------------------------ */
  const post = map.suggestMappings(JOTFORM_HEADERS);
  ok("all 30 still resolve", post.mappings.length + post.ignored.length, 30);
  ok("none unmapped", post.unmapped, []);
  ok("exactly one column asks the coach to opt in",
    post.mappings.filter((m) => m.optIn).map((m) => m.header), ["Date of Birth"]);

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
