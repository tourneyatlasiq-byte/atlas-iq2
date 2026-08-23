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
  // Migrations A and B landed, so nothing is pending. The guard remains so a
  // future field can be added as pending without reworking the planner.
  ok("no field awaits a migration", reg.pendingFields(), []);
  ok("every importable field is now writable",
    reg.writableFields().length, reg.FIELDS.filter((f) => f.importable).length);

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
  // Superseded by coach testing: a parent's email changing does not make the
  // child a different person.
  ok("a DIFFERENT contact email alone is NOT a player conflict",
    mat.matchPlayer({ full_name:"Aubs Rivers", grad_year:2028,
      contacts:[{ email:"other@example.test" }] }, existing).classification, M.CONFIDENT);
  ok("...and with no other evidence it still only needs review",
    mat.matchPlayer({ full_name:"Aubs Rivers",
      contacts:[{ email:"other@example.test" }] }, existing).classification, M.POSSIBLE);

  /* ---- Near-miss spellings propose a candidate, never a duplicate -------- */
  ok("one character out proposes the existing player",
    mat.matchPlayer({ full_name:"Aubs Rivera", grad_year:2028 }, existing).classification, M.POSSIBLE);
  ok("...and names the candidate so the coach can compare",
    mat.matchPlayer({ full_name:"Aubs Riverr", grad_year:2028 }, existing).candidate?.id, "p1");
  ok("a two-character difference on a long name proposes too",
    mat.matchPlayer({ full_name:"Aubrey Riverss" }, existing).classification, M.POSSIBLE);
  ok("a genuinely different short name stays NEW",
    mat.matchPlayer({ full_name:"Mia Vale" }, existing).classification, M.NEW);
  ok("fuzzy never auto-merges: it only ever yields POSSIBLE",
    mat.matchPlayer({ full_name:"Aubs Riverr", grad_year:2028,
      date_of_birth:"2010-04-03" }, existing).classification, M.POSSIBLE);
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

  // Structured names now have real columns, so this row executes.
  const structured = { full_name:"Nia Frost", last_name:"Frost", legal_first_name:"Nia", contacts:[] };
  const structuredPlan = pln.buildRowPlan({
    row:structured, match:{ classification:M.NEW, candidate:null, reasons:[] }, existingPlayer:null });
  ok("structured names are executable now", structuredPlan.executable, true);
  ok("...and nothing is pending", structuredPlan.pending, []);

  // The guard itself still works: a hypothetical pending plan is refused.
  let pendingThrew = false;
  try {
    pln.assertPlanSafe({ writes:[{ table:"players", values:{} }],
                         pending:["some_future_field"], executable:true });
  } catch { pendingThrew = true; }
  ok("a pending plan claiming executable still throws", pendingThrew, true);

  const contactRow = { full_name:"Nia Frost",
    contacts:[{ full_name:"Kit Frost", email:"kit@example.test" }] };
  const contactPlan = pln.buildRowPlan({
    row:contactRow, match:{ classification:M.NEW, candidate:null, reasons:[] }, existingPlayer:null });
  // C1: ALL contacts route to player_contacts, the first included.
  ok("a single contact is executable", contactPlan.executable, true);
  ok("...and NEVER writes to players.parent_*",
    Object.keys(contactPlan.writes[0].values).filter((k) => k.startsWith("parent_")), []);
  ok("...it creates a player_contacts row",
    contactPlan.writes.filter((w) => w.table === "player_contacts").length, 1);
  ok("...marked primary for a new player",
    contactPlan.writes.find((w) => w.table === "player_contacts").isPrimary, true);

  const twoContacts = pln.buildRowPlan({
    row: { full_name:"Nia Frost", contacts:[
      { full_name:"Kit Frost", email:"kit@example.test" },
      { full_name:"Ari Frost", email:"ari@example.test" }] },
    match:{ classification:M.NEW, candidate:null, reasons:[] }, existingPlayer:null });
  ok("two contacts are now executable", twoContacts.executable, true);
  ok("...both land in player_contacts",
    twoContacts.writes.filter((w) => w.table === "player_contacts").length, 2);
  ok("...exactly one is primary",
    twoContacts.writes.filter((w) => w.table === "player_contacts" && w.isPrimary).length, 1);
  ok("...ordered by their position in the file",
    twoContacts.writes.filter((w) => w.table === "player_contacts").map((w) => w.sortOrder), [1, 2]);
  ok("...and neither is concatenated into notes",
    twoContacts.writes[0].values.notes, undefined);

  /* ---- A8 prohibition --------------------------------------------------- */
  console.log("\nA8 prohibition");
  const allPlans = [newPlan, fillPlan, conflictPlan, structuredPlan, contactPlan];
  const tables = [...new Set(allPlans.flatMap((p) => p.writes.map((w) => w.table)))].sort();
  // The invariant is that nothing OUTSIDE the permitted set appears — not that
  // every permitted table appears in every batch.
  ok("nothing outside the permitted set is ever written",
    tables.filter((t) => ![...pln.ALLOWED_TABLES,
                          ...Object.keys(pln.CONDITIONAL_TABLES)].includes(t)), []);
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
  ok("JotForm row is now fully executable (Migrations A and B landed)",
    jf[0].plan.executable, true);
  ok("...with nothing awaiting a migration", jf[0].plan.pending, []);
  ok("only permitted tables appear",
    [...new Set(jf[0].plan.writes.map((w) => w.table))].sort(),
    ["player_contacts","player_links","players","team_season_players"]);

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
  ok("simple sheet with one parent is fully executable",
    simple[0].plan.executable, true);
  ok("...writing the parent to player_contacts, not the flat fields",
    simple[0].plan.writes.find((w) => w.table === "player_contacts").values.email,
    "robin@example.test");

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


  /* ---- Identity is not a field decision --------------------------------- */
  console.log("\nIdentity vs field values");

  const clash = { full_name:"Aubs Rivers", grad_year:2029, contacts:[] };
  const clashMatch = mat.matchPlayer(clash, existing);
  ok("wrong existing grad year -> CONFLICT", clashMatch.classification, M.CONFLICT);

  const idOnly = pln.buildRowPlan({ row:clash, match:clashMatch,
    existingPlayer:existing[0], identity:"same" });
  ok("SAME PLAYER alone does not resolve the field", idOnly.executable, false);
  ok("...and says a decision is still needed",
    idOnly.blockers.some((b) => b.includes("undecided")), true);
  ok("...and writes nothing for the disputed field",
    idOnly.writes[0].values.grad_year, undefined);

  const keepMine = pln.buildRowPlan({ row:clash, match:clashMatch,
    existingPlayer:existing[0], identity:"same", decisions:{ grad_year:"existing" } });
  ok("keeping the Season Tempo value leaves it unwritten",
    keepMine.writes[0].values.grad_year, undefined);
  ok("...and the row becomes executable", keepMine.executable, true);
  ok("...and the resolved value is stated as the existing one",
    keepMine.resolved.find((r) => r.key === "grad_year").chosen, 2028);

  const useFile = pln.buildRowPlan({ row:clash, match:clashMatch,
    existingPlayer:existing[0], identity:"same", decisions:{ grad_year:"incoming" } });
  ok("choosing the file writes the imported year", useFile.writes[0].values.grad_year, 2029);
  ok("...and the resolved value reflects it",
    useFile.resolved.find((r) => r.key === "grad_year").chosen, 2029);

  const dobClash = { full_name:"Aubs Rivers", date_of_birth:"2010-07-18", contacts:[] };
  const dobMatch = mat.matchPlayer(dobClash, existing);
  const keepDob = pln.buildRowPlan({ row:dobClash, match:dobMatch,
    existingPlayer:existing[0], identity:"same", decisions:{ date_of_birth:"existing" } });
  ok("keeping the Season Tempo DOB does not overwrite it",
    keepDob.writes[0].values.date_of_birth, undefined);
  ok("...and states the retained value",
    keepDob.resolved.find((r) => r.key === "date_of_birth").chosen, "2010-04-03");

  const different = pln.buildRowPlan({ row:clash, match:clashMatch,
    existingPlayer:existing[0], identity:"new" });
  ok("DIFFERENT PLAYER creates a new record and touches nothing existing",
    different.writes[0].op, "insert");
  ok("...with no target id", different.writes[0].targetId, null);

  const sparse = mat.matchPlayer({ full_name:"Ana Cole", contacts:[] }, existing);
  ok("a sparse existing record still needs confirmation", sparse.classification, M.POSSIBLE);
  ok("...and is not executable until answered",
    pln.buildRowPlan({ row:{ full_name:"Ana Cole", contacts:[] }, match:sparse,
      existingPlayer:existing[1] }).executable, false);

  const emailOnly = { full_name:"Aubs Rivers", grad_year:2028, date_of_birth:"2010-04-03",
    contacts:[{ full_name:"New Parent", email:"different@example.test" }] };
  const emailMatch = mat.matchPlayer(emailOnly, existing);
  ok("a different parent email does not make the player a different person",
    emailMatch.classification, M.CONFIDENT);


  /* ---- Manual mapping and headerless files ------------------------------ */
  console.log("\nManual mapping");

  ok("real-world header wording is recognised",
    map.suggestMappings(["Athlete","Uniform #","School Year"]).mappings.map((m) => m.key),
    ["full_name","jersey_number","grad_year"]);
  ok("a genuinely unknown header is offered for manual mapping, not guessed",
    map.suggestMappings(["Athlete","Random Column"]).unmapped, ["Random Column"]);
  ok("selectable fields cover every level a coach can map",
    map.selectableFields().map((g) => g.group).sort(),
    ["Links","Parent or guardian","Player","This season"]);
  ok("ignored fields are never offered as a choice",
    map.selectableFields().flatMap((g) => g.fields).filter((f) => f.key.startsWith("_ignore")), []);

  ok("a header row is detected", map.looksLikeHeaders(
    ["Player","Jersey Number","Graduation Year"], ["Ada","7","2029"]), true);
  ok("a data row is NOT mistaken for headers", map.looksLikeHeaders(
    ["Ada Nkemelu","7","2029"], ["Wren Calder","44","2028"]), false);
  ok("headerless columns are labelled A, B, C",
    map.columnLabels(3), ["Column A","Column B","Column C"]);

  // A coach maps "Athlete" to the player name by hand.
  const manual = map.applyMappings(
    { "Athlete":"Ada Nkemelu", "Uniform #":"7" },
    [{ header:"Athlete", key:"full_name", index:null, level:"player" },
     { header:"Uniform #", key:"jersey_number", index:null, level:"season" }]);
  ok("a manual mapping produces the right values",
    [manual.full_name, manual.jersey_number], ["Ada Nkemelu","7"]);

  // And overrides an incorrect automatic suggestion.
  const auto = map.suggestMappings(["Email"]);
  ok("auto maps a bare Email column to the contact", auto.mappings[0].key, "contact_email");
  const overridden = map.applyMappings({ "Email":"ada@example.test" },
    [{ header:"Email", key:"player_email", index:null, level:"player" }]);
  ok("the coach can redirect it to the player instead",
    overridden.player_email, "ada@example.test");


  /* ---- Completeness: registry <-> dropdown ------------------------------ */
  console.log("\nRegistry and dropdown completeness");

  const offered = new Set(map.selectableFields().flatMap((g) => g.fields).map((f) => f.key));
  const selectable = reg.FIELDS.filter((f) => f.importable && !reg.isIgnored(f.key));

  ok("EVERY importable registry field is offered in the dropdown",
    selectable.filter((f) => !offered.has(f.key)).map((f) => f.key), []);
  ok("EVERY dropdown option resolves to a registered field",
    [...offered].filter((k) => !reg.BY_KEY.get(k)), []);
  ok("no dropdown option is an ignored column",
    [...offered].filter((k) => reg.isIgnored(k)), []);
  ok("every dropdown option has a destination",
    [...offered].filter((k) => !reg.BY_KEY.get(k)?.destination), []);
  ok("the X handle is now selectable", offered.has("social_handle"), true);
  ok("player or staff is now selectable", offered.has("person_type"), true);

  /* ---- X handles -------------------------------------------------------- */
  console.log("\nX handle");

  const forms = ["@wrenny_88","wrenny_88","x.com/wrenny_88",
                 "https://twitter.com/wrenny_88","https://www.x.com/wrenny_88?s=20"];
  ok("all supported forms resolve to one URL",
    [...new Set(forms.map((f) => nrm.parseXHandle(f).url))], ["https://x.com/wrenny_88"]);
  ok("the coach's original value is preserved exactly",
    forms.map((f) => nrm.parseXHandle(f).label), forms);
  ok("the username is never altered",
    nrm.parseXHandle("@Wrenny_88").handle, "Wrenny_88");
  for (const bad of ["x.com/wrenny/status/1","https://instagram.com/wrenny","not a handle!",
                     "way_too_long_a_username_here"]) {
    ok(`"${bad}" is not guessed at`, nrm.parseXHandle(bad), null);
  }

  const xRow = { full_name:"Nia Frost", social_handle:"@nia_frost", contacts:[] };
  const xPlan = pln.buildRowPlan({ row:xRow,
    match:{ classification:M.NEW, candidate:null, reasons:[] }, existingPlayer:null });
  ok("a handle produces a player_links write",
    xPlan.writes.filter((w) => w.table === "player_links").length, 1);
  ok("...with link_type X, a composed URL and the original label",
    xPlan.writes.find((w) => w.table === "player_links").values,
    { link_type:"X", url:"https://x.com/nia_frost", label:"@nia_frost" });

  const badX = pln.buildRowPlan({
    row:{ full_name:"Nia Frost", social_handle:"not a handle!", contacts:[] },
    match:{ classification:M.NEW, candidate:null, reasons:[] }, existingPlayer:null });
  ok("an unresolvable handle blocks the row for review", badX.executable, false);
  ok("...and writes no link", badX.writes.some((w) => w.table === "player_links"), false);

  /* ---- player_links is conditional, not open ---------------------------- */
  console.log("\nplayer_links is conditionally permitted");

  let threw = false;
  try { pln.assertPlanSafe({ writes:[{ table:"player_links", values:{} }], pending:[] }); }
  catch { threw = true; }
  ok("a player_links write WITHOUT a link type throws", threw, true);

  threw = false;
  try {
    pln.assertPlanSafe({ writes:[{ table:"player_links", linkType:"Instagram", values:{} }], pending:[] });
  } catch { threw = true; }
  ok("an unsupported link type throws", threw, true);

  ok("a supported link type is permitted",
    pln.assertPlanSafe({ writes:[{ table:"player_links", linkType:"X", values:{} }], pending:[] }), true);
  ok("player_links has left the blanket prohibition",
    pln.FORBIDDEN_TABLES.includes("player_links"), false);
  ok("...but is not generally allowed either",
    pln.ALLOWED_TABLES.includes("player_links"), false);
  ok("an arbitrary field cannot reach it: only linkType fields carry one",
    reg.FIELDS.filter((f) => f.linkType).map((f) => f.key), ["social_handle"]);

  /* ---- person_type ------------------------------------------------------ */
  console.log("\nPlayer or staff");

  ok("stored values are lowercase, as production holds them",
    ["Player","coach","Manager"].map((v) => nrm.parsePersonType(v).person_type),
    ["player","coach","manager"]);
  ok("a named staff role sets the PAIR",
    nrm.parsePersonType("Head Coach"), { person_type:"coach", other_role_label:"Head Coach" });
  ok("\"Staff\" is a UI grouping and is refused", nrm.parsePersonType("Staff"), null);
  ok("an unknown role is refused rather than defaulted",
    nrm.parsePersonType("Bench Boss"), null);

  const staffPlan = pln.buildRowPlan({
    row:{ full_name:"Robin Calder", person_type:"Head Coach", contacts:[] },
    match:{ classification:M.NEW, candidate:null, reasons:[] }, existingPlayer:null });
  ok("the pair is written together",
    [staffPlan.writes[0].values.person_type, staffPlan.writes[0].values.other_role_label],
    ["coach","Head Coach"]);

  const badRole = pln.buildRowPlan({
    row:{ full_name:"Robin Calder", person_type:"Bench Boss", contacts:[] },
    match:{ classification:M.NEW, candidate:null, reasons:[] }, existingPlayer:null });
  ok("an unrecognised role blocks the row", badRole.executable, false);
  ok("...and never silently defaults to player",
    badRole.writes[0].values.person_type, undefined);

  /* ---- forbidden destinations still forbidden --------------------------- */
  for (const t of ["player_payments","payment_log","tournament_participants","profiles",
                   "player_guardians","invites","documents","plate_appearances",
                   "player_college_interests","player_stats","games","budget_transactions"]) {
    let t2 = false;
    try { pln.assertPlanSafe({ writes:[{ table:t, values:{} }], pending:[] }); } catch { t2 = true; }
    ok(`${t} still throws`, t2, true);
  }

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
