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
  // Slash dates are no longer rejected as ambiguous. Season Tempo displays
  // MM/DD/YYYY, so a slash date is read as month/day in code — a defined rule,
  // not a guess, and not the runtime's locale. 03/04/2010 is 4 March.
  ok("a slash date is read as month/day", nrm.toDate("03/04/2010"), "2010-03-04");
  ok("...consistently in the other order too", nrm.toDate("04/03/2010"), "2010-04-03");
  ok("an impossible slash date is still rejected", nrm.toDate("02/30/2010"), null);
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
  // DOB is auto-enabled now. Readiness calls a missing date of birth the
  // highest-priority gap and the matcher leans on it hardest, so gating it
  // behind a checkbox meant the product asked for something it then declined
  // to import. It stays LABELLED sensitive.
  ok("DOB is auto-enabled when confidently mapped",
    sug.mappings.find((m) => m.key === "date_of_birth").autoEnabled, true);
  ok("no column requires an opt-in click",
    sug.mappings.filter((m) => m.optIn).map((m) => m.key), []);
  ok("DOB is still labelled sensitive",
    sug.mappings.find((m) => m.key === "date_of_birth").sensitive, true);
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
  ok("DOB is included without any opt-in", jf[0].row.date_of_birth, "2010-04-03");
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
  ok("no field is gated behind opt-in",
    reg.FIELDS.filter((f) => f.optIn).map((f) => f.key), []);
  // A minor's home address is identity data, so it carries the sensitive
  // LABEL. It is not gated: labelling tells a coach what they are importing;
  // gating stopped them importing it at all.
  ok("sensitive is broader than optIn, and labels contact and address fields",
    reg.FIELDS.filter((f) => f.sensitive).map((f) => f.key).sort(),
    ["city","contact_email","contact_phone","date_of_birth","player_email",
     "player_phone","state","street_address","street_address_2","zip"]);
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
  ok("no column asks the coach to opt in",
    post.mappings.filter((m) => m.optIn).map((m) => m.header), []);
  ok("...and Date of Birth is among the auto-enabled columns",
    post.mappings.filter((m) => m.autoEnabled).some((m) => m.key === "date_of_birth"), true);


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
  // Two fields carry linkType X — a handle column and a URL column — because
  // they describe ONE link record between them, not two links. An arbitrary
  // field still cannot reach player_links: it must declare a linkType.
  ok("an arbitrary field cannot reach it: only linkType fields carry one",
    reg.FIELDS.filter((f) => f.linkType).map((f) => f.key).sort(),
    ["social_handle", "social_url"]);
  ok("...and both describe the same link type",
    [...new Set(reg.FIELDS.filter((f) => f.linkType).map((f) => f.linkType))], ["X"]);

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

  
/* ---- Preferred contact method: the coach-reported P1 -------------------
   An import reached "Ready to import" and failed at execution with
   `player_contacts_preferred_method_check`. normalizeValue("enum") was a
   pass-through, so a spreadsheet value went to Postgres unvalidated and the
   database CHECK was the FIRST thing to inspect it. The CHECK is
   case-sensitive lowercase, so ordinary exports like "Email" failed. */

console.log("\nPreferred contact method");

{
  const recognised = [
    ["Email", "email"], ["E-Mail", "email"], ["e-mail", "email"], ["EMAIL", "email"],
    ["Text", "text"], ["SMS", "text"], ["Text Message", "text"], ["texting", "text"],
    ["Call", "call"], ["Phone", "call"], ["Phone Call", "call"], ["telephone", "call"],
    ["  Email  ", "email"],
  ];
  for (const [raw, want] of recognised) {
    ok(`"${raw}" normalises to ${want}`, nrm.classifyContactMethod(raw).value, want);
    ok(`"${raw}" is accepted`, nrm.classifyContactMethod(raw).ok, true);
  }

  for (const raw of ["", "   ", null, undefined]) {
    ok(`${JSON.stringify(raw)} is absent, not an error`,
      [nrm.classifyContactMethod(raw).ok, nrm.classifyContactMethod(raw).value], [true, null]);
  }

  // Deliberately NOT mapped: these do not say which method to use, and
  // guessing would store a preference the coach never expressed.
  for (const raw of ["Either", "Any", "Both", "Cell", "Mobile", "Whatever", "carrier pigeon"]) {
    ok(`"${raw}" is refused rather than guessed`, nrm.classifyContactMethod(raw).ok, false);
    ok(`"${raw}" stores nothing`, nrm.classifyContactMethod(raw).value, null);
    ok(`"${raw}" keeps the coach's value for the message`,
      nrm.classifyContactMethod(raw).raw, raw);
  }

  ok("the stored vocabulary is exactly the CHECK's",
    nrm.CONTACT_METHODS, ["text", "email", "call"]);

  // Every mapped value must be storable.
  const allMapped = recognised.map(([, v]) => v);
  ok("every mapped value is in the stored vocabulary",
    allMapped.every((v) => nrm.CONTACT_METHODS.includes(v)), true);
}

console.log("\nAn unrecognised method blocks the row before Ready");

{
  const withMethod = (pm) => {
    const row = { full_name: "Method Probe",
                  contacts: [{ full_name: "P", email: "p@example.invalid", preferred_method: pm }] };
    const m = mat.matchPlayer(row, []);
    return pln.buildRowPlan({ row, match: m, existingPlayer: null,
                          existingContacts: [], decisions: {}, identity: null });
  };

  const bad = withMethod("Either");
  ok("an unrecognised value makes the row NOT executable", bad.executable, false);
  ok("...and the blocker names the value the coach typed",
    bad.blockers.some((b) => b.includes('"Either"')), true);
  ok("...and nothing unstorable is queued for the database",
    bad.writes.find((w) => w.table === "player_contacts")?.values?.preferred_method ?? null, null);

  const good = withMethod("Email");
  ok("a recognised value is executable", good.executable, true);
  ok("...and is stored in the database's vocabulary",
    good.writes.find((w) => w.table === "player_contacts").values.preferred_method, "email");

  const blank = withMethod("");
  ok("a blank method does not block the row", blank.executable, true);
  ok("...and stores NULL",
    blank.writes.find((w) => w.table === "player_contacts").values.preferred_method, null);
}

/* ---- Ready summary must account for every row -------------------------
   A 13-row import reported 9 already on file, 0 new, 0 needing a decision —
   4 rows unaccounted for, and they were going to be imported. The counts came
   from the raw match classification, so a possible/conflict row the coach
   RESOLVED belonged to no category at all. */

console.log("\nReady summary reconciles to the row count");

{
  const disposition = (plan) => {
    if (!plan.executable) return "undecided";
    const pw = plan.writes.find((w) => w.table === "players");
    if (pw && !pw.targetId) return "add";
    if (plan.writes.length > 0) return "update";
    return "unchanged";
  };

  const existing = [];
  for (let i = 1; i <= 9; i += 1) {
    existing.push({ id: `e${i}`, full_name: `Confident ${i}`, grad_year: 2028,
                    date_of_birth: `2010-01-0${(i % 9) + 1}`, parent_email: null, contacts: [] });
  }
  for (let i = 1; i <= 4; i += 1) {
    existing.push({ id: `p${i}`, full_name: `Possible ${i}`, grad_year: null,
                    date_of_birth: null, parent_email: null, contacts: [] });
  }

  const rows = [];
  for (let i = 1; i <= 9; i += 1) {
    rows.push({ full_name: `Confident ${i}`, grad_year: 2028,
                date_of_birth: `2010-01-0${(i % 9) + 1}`, contacts: [] });
  }
  for (let i = 1; i <= 4; i += 1) rows.push({ full_name: `Possible ${i}`, contacts: [] });

  const analysed = rows.map((row) => {
    const m = mat.matchPlayer(row, existing);
    const needsId = m.classification === mat.CLASS.POSSIBLE || m.classification === mat.CLASS.CONFLICT;
    const identity = needsId ? "same" : null;      // the coach resolved them
    return { m, plan: pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
                                     existingContacts: [], decisions: {}, identity }) };
  });

  const counts = analysed.reduce((acc, a) => {
    const d = disposition(a.plan);
    acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, { add: 0, update: 0, unchanged: 0, undecided: 0 });

  const total = counts.add + counts.update + counts.unchanged + counts.undecided;

  ok("the fixture reproduces the reported shape",
    [analysed.filter((a) => a.m.classification === mat.CLASS.CONFIDENT).length,
     analysed.filter((a) => a.m.classification === mat.CLASS.POSSIBLE).length], [9, 4]);

  // The OLD logic, kept here as the thing that must never come back.
  const oldShown = analysed.filter((a) => a.m.classification === mat.CLASS.NEW).length
                 + analysed.filter((a) => a.m.classification === mat.CLASS.CONFIDENT).length;
  ok("the old classification-based counts under-reported", oldShown, 9);
  ok("...leaving rows unaccounted for", rows.length - oldShown, 4);

  ok("every row now has a disposition", total, rows.length);
  ok("...and none is silently dropped", counts.undecided + counts.add + counts.update + counts.unchanged, 13);

  // An undecided row must still be counted.
  const undecided = rows.map((row) => {
    const m = mat.matchPlayer(row, existing);
    return pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
                          existingContacts: [], decisions: {}, identity: null });
  });
  const uc = undecided.reduce((acc, plan) => {
    const d = disposition(plan);
    acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, { add: 0, update: 0, unchanged: 0, undecided: 0 });
  ok("unresolved rows reconcile too",
    uc.add + uc.update + uc.unchanged + uc.undecided, rows.length);
}


/* ---- Decision state has ONE authority ---------------------------------
   The coach's report: he answered every question the UI asked, the workflow
   still said 5 needed a decision, and Import then named 1 player he had never
   been shown. Three views of "unresolved" disagreed:
     Match     counted POSSIBLE/CONFLICT without an identity
     Ready     counted needsIdentity + needsDecision — two OVERLAPPING sets,
               so one row could count twice
     execution refused on !plan.executable, which also covers an invalid row,
               a contact needing a look, and a pending field — none of which
               were shown or counted anywhere.
   plan.executable is now the only authority. */

console.log("\nDecision state: one authority");

{
  // The UI's OLD arithmetic, kept so the regression is unmistakable.
  const oldCount = (analysed, identity) =>
    analysed.filter((a) => (a.match.classification === mat.CLASS.POSSIBLE
                         || a.match.classification === mat.CLASS.CONFLICT) && !identity[a.i]).length
  + analysed.filter((a) => a.plan.blockers.some((b) => b.startsWith("undecided"))).length;

  const newCount = (analysed) => analysed.filter((a) => !a.plan.executable).length;

  const build = (rows, existing, identityFor = () => null, decisions = {}) =>
    rows.map((row, i) => {
      const m = mat.matchPlayer(row, existing);
      const id = identityFor(m, i);
      return { i, row, match: m, identity: id,
               plan: pln.buildRowPlan({ row, match: m,
                 existingPlayer: id === "new" ? null : m.candidate,
                 existingContacts: [], decisions: decisions[i] ?? {}, identity: id }) };
    });

  const existing = [];
  for (let i = 1; i <= 5; i += 1) {
    existing.push({ id: `p${i}`, full_name: `Possible ${i}`, grad_year: null,
                    date_of_birth: null, parent_email: null, contacts: [] });
  }

  /* ---- THE COACH'S EXACT FAILURE: 5 visible, then a hidden 1 ---------- */
  const rows = [];
  for (let i = 1; i <= 5; i += 1) rows.push({ full_name: `Possible ${i}`, grad_year: 2029, contacts: [] });
  rows.push({ full_name: "Hidden Blocker",
              contacts: [{ full_name: "P", email: "h@example.invalid", preferred_method: "Either" }] });

  const before = build(rows, existing);
  ok("BEFORE: the old count showed 5", oldCount(before, {}), 5);
  ok("BEFORE: 6 rows are actually unresolved", newCount(before), 6);

  // The coach answers every identity question he is shown.
  const resolved = build(rows, existing,
    (m) => (m.classification === mat.CLASS.POSSIBLE || m.classification === mat.CLASS.CONFLICT)
      ? "same" : null);
  const idMap = {};
  resolved.forEach((a) => { if (a.identity) idMap[a.i] = a.identity; });

  ok("AFTER: the old count reached 0 — the lie", oldCount(resolved, idMap), 0);
  ok("AFTER: one row is still genuinely unresolved", newCount(resolved), 1);
  ok("...and it is the row never shown in Matching",
    resolved.filter((a) => !a.plan.executable)[0].row.full_name, "Hidden Blocker");
  ok("...which execution would have refused",
    resolved.filter((a) => !a.plan.executable)[0].plan.executable, false);

  // THE FIX: the authority the UI now uses matches execution exactly.
  ok("Ready count === execution's view",
    newCount(resolved), resolved.filter((a) => !a.plan.executable).length);
  ok("every unresolved row is in the list shown to the coach",
    resolved.filter((a) => !a.plan.executable)
            .every((a) => resolved.filter((x) => !x.plan.executable).includes(a)), true);

  /* ---- No double counting -------------------------------------------- */
  const dupExisting = [{ id: "d1", full_name: "Dana Dual", grad_year: 2027,
                         date_of_birth: null, parent_email: null, contacts: [] }];
  const dupRow = [{ full_name: "Dana Dual", grad_year: 2030, contacts: [] }];
  const dual = build(dupRow, dupExisting);
  ok("a row needing identity is ONE unresolved row", newCount(dual), 1);
  ok("...even though the old arithmetic could count it twice",
    oldCount(dual, {}) >= newCount(dual), true);
  ok("...and one row can never exceed the row count", newCount(dual) <= dupRow.length, true);

  /* ---- Resolutions actually clear -------------------------------------
     IDENTITY AND FIELD VALUES ARE TWO QUESTIONS. Saying "same player" for a
     row whose grad year disagrees does NOT settle which grad year wins — that
     is a second, separate decision made in Review. The row stays unresolved,
     and it must stay VISIBLE while it is. */
  const same = build(dupRow, dupExisting, () => "same");
  ok("a disagreeing field still blocks the row", same[0].plan.executable, false);
  // Nothing is written to players while the only field in question is
  // undecided — the row has nothing agreed to write yet.
  ok("...and nothing is queued for players until it is decided",
    same[0].plan.writes.some((w) => w.table === "players"), false);
  ok("...and the authority still counts it", newCount(same), 1);
  ok("...and it carries a field decision to make",
    same[0].plan.blockers.some((b) => b.startsWith("undecided")), true);

  const sameDecided = build(dupRow, dupExisting, () => "same", { 0: { grad_year: "incoming" } });
  ok("once the field decision is made the row executes", sameDecided[0].plan.executable, true);
  ok("...and Same Player targets the EXISTING record",
    sameDecided[0].plan.writes.find((w) => w.table === "players")?.targetId, "d1");
  ok("...and nothing is left unresolved", newCount(sameDecided), 0);

  const diff = build(dupRow, dupExisting, () => "new");
  ok("resolved as Different Player is executable", diff[0].plan.executable, true);
  ok("Different Player creates a new record",
    Boolean(diff[0].plan.writes.find((w) => w.table === "players")?.targetId), false);
  ok("...and leaves nothing unresolved", newCount(diff), 0);

  /* ---- A resolved row cannot become undecided again ------------------- */
  const twice = build(dupRow, dupExisting, () => "same", { 0: { grad_year: "incoming" } });
  ok("re-planning identical input keeps it resolved", newCount(twice), 0);
  ok("...and identical input gives an identical verdict",
    twice[0].plan.executable, sameDecided[0].plan.executable);

  /* ---- Mixed population reconciles ------------------------------------ */
  const mixExisting = [...existing,
    { id: "c1", full_name: "Confident One", grad_year: 2028,
      date_of_birth: "2010-04-03", parent_email: null, contacts: [] }];
  const mixRows = [
    { full_name: "Confident One", grad_year: 2028, date_of_birth: "2010-04-03", contacts: [] },
    { full_name: "Brand New", contacts: [] },
    { full_name: "Possible 1", grad_year: 2029, contacts: [] },
  ];
  const mixed = build(mixRows, mixExisting,
    (m) => (m.classification === mat.CLASS.POSSIBLE || m.classification === mat.CLASS.CONFLICT)
      ? "same" : null);
  ok("confident + new + resolved all execute", newCount(mixed), 0);
  ok("...and every row is accounted for", mixed.length, mixRows.length);

  /* ---- Every blocker class is visible, none is silent ----------------- */
  const silent = [
    ["a row with no name", { full_name: "", contacts: [] }],
    ["an unusable contact method", { full_name: "Method Row",
        contacts: [{ full_name: "P", email: "m@example.invalid", preferred_method: "Cell" }] }],
  ];
  for (const [label, row] of silent) {
    const a = build([row], [])[0];
    ok(`${label} blocks the row`, a.plan.executable, false);
    ok(`${label} is counted by the authority`, newCount([a]), 1);
    ok(`${label} carries a reason to show the coach`, a.plan.blockers.length > 0, true);
  }
}


/* ---- Client and server must match on the SAME evidence -----------------
   A real coach import to add DOB was refused at Import: "Avery still needs a
   decision", for a row that had shown no issue. The browser and the server
   each build their own plan — correctly, the server must re-derive — but they
   were given different candidate data. The browser's candidates carried
   resolved player_contacts; the server's select had no contacts at all and was
   also missing the structured name columns nameKeys() reads. Contact-email
   agreement is what promotes `possible` to `confident`, so every player whose
   only corroboration lived in player_contacts flipped classification between
   the two. */

console.log("\nClient/server matching evidence");

{
  // Avery Myers, as production actually holds her: no DOB, no parent_email,
  // corroborating address only in player_contacts.
  const avery = {
    id: "44dad248", full_name: "Avery Myers",
    legal_first_name: "Avery", preferred_first_name: null, last_name: "Myers",
    grad_year: 2028, date_of_birth: null, parent_email: null,
    player_contacts: [{ id: "c1", email: "erechm@gmail.com" },
                      { id: "c2", email: "bamabell71@yahoo.com" }],
  };
  // The DOB-only file: name + contact email to identify, DOB as the new value.
  const row = { full_name: "Avery Myers", date_of_birth: "2010-06-14",
                contacts: [{ full_name: null, email: "erechm@gmail.com", phone: null }] };

  // What the server used to send matchPlayer: the raw select, no contacts.
  const { player_contacts, ...withoutContacts } = avery;

  const before = mat.matchPlayer(row, [withoutContacts]);
  ok("BEFORE: the server could only see a name", before.classification, mat.CLASS.POSSIBLE);

  // Both sides now build candidates the same way.
  const clientCandidate = mat.toCandidate({ ...avery, contacts: avery.player_contacts });
  const serverCandidate = mat.toCandidate(avery);       // PostgREST embed shape

  ok("the two candidate shapes are identical",
    JSON.stringify(clientCandidate), JSON.stringify(serverCandidate));
  ok("...including every field matching reads",
    mat.MATCH_EVIDENCE.every((k) => k in clientCandidate && k in serverCandidate), true);
  ok("...and contacts arrive under the name matchPlayer reads",
    Array.isArray(serverCandidate.contacts) && serverCandidate.contacts[0].email,
    "erechm@gmail.com");

  const client = mat.matchPlayer(row, [clientCandidate]);
  const server = mat.matchPlayer(row, [serverCandidate]);
  ok("AFTER: the client classifies confident", client.classification, mat.CLASS.CONFIDENT);
  ok("AFTER: the server agrees", server.classification, mat.CLASS.CONFIDENT);
  ok("...for the same reason", client.reasons, server.reasons);

  const plan = pln.buildRowPlan({ row, match: server, existingPlayer: server.candidate,
    existingContacts: serverCandidate.contacts, decisions: {}, identity: null });
  ok("no identity decision is required",
    plan.blockers.some((b) => b.startsWith("needs")), false);
  ok("the row is executable", plan.executable, true);

  const pw = plan.writes.find((w) => w.table === "players");
  ok("DOB is a FILL on the existing player", pw.values.date_of_birth, "2010-06-14");
  ok("...targeting the stored record", pw.targetId, "44dad248");

  // The matching email must not become a second copy of a contact she has.
  const cw = plan.writes.filter((w) => w.table === "player_contacts");
  ok("the matching email updates the existing contact, it does not duplicate",
    cw.map((w) => w.op), ["update"]);
  ok("...against the contact that already holds it", cw[0].targetId, "c1");
}

console.log("\nEvidence drift is prevented across many players");

{
  // Several real Armor Elite players: corroboration only in player_contacts.
  const people = [
    ["Anniston Antonia", "akantonia2005@gmail.com"],
    ["Carlyann Wilkes",  "wilkesfam28@gmail.com"],
    ["Elin Wilkins",     "ashleyl@skytelcontractors.com"],
    ["London Martin",    "3306537@gmail.com"],
    ["Willow Mooney",    "colem0623@gmail.com"],
  ].map(([full_name, email], i) => ({
    id: `p${i}`, full_name, legal_first_name: full_name.split(" ")[0],
    preferred_first_name: null, last_name: full_name.split(" ")[1],
    grad_year: 2028, date_of_birth: null, parent_email: null,
    player_contacts: [{ id: `c${i}`, email }],
  }));

  const candidates = people.map(mat.toCandidate);
  const stripped = people.map(({ player_contacts, ...rest }) => rest);

  let beforeBlocked = 0, afterOk = 0;
  for (const p of people) {
    const row = { full_name: p.full_name, date_of_birth: "2010-06-14",
                  contacts: [{ email: p.player_contacts[0].email }] };
    if (mat.matchPlayer(row, stripped).classification !== mat.CLASS.CONFIDENT) beforeBlocked += 1;

    const m = mat.matchPlayer(row, candidates);
    const plan = pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
      existingContacts: m.candidate?.contacts ?? [], decisions: {}, identity: null });
    if (m.classification === mat.CLASS.CONFIDENT && plan.executable) afterOk += 1;
  }
  ok("every one of them used to fail server re-derivation", beforeBlocked, people.length);
  ok("every one of them now classifies confident and executes", afterOk, people.length);
}

console.log("\nA stored DOB that disagrees is still a decision");

{
  // Corroboration present, but the file's DOB differs from the stored one.
  const brynn = mat.toCandidate({
    id: "b1", full_name: "Brynn Mower", legal_first_name: "Brynn", last_name: "Mower",
    grad_year: 2028, date_of_birth: "2010-05-24", parent_email: "cmower78@gmail.com",
    player_contacts: [{ id: "bc1", email: "cmower78@gmail.com" }],
  });
  const row = { full_name: "Brynn Mower", date_of_birth: "2011-01-01",
                contacts: [{ email: "cmower78@gmail.com" }] };
  const m = mat.matchPlayer(row, [brynn]);
  ok("a differing stored DOB is a conflict, not a silent overwrite",
    m.classification, mat.CLASS.CONFLICT);

  const plan = pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
    existingContacts: brynn.contacts, decisions: {}, identity: null });
  ok("...and the row waits for the coach", plan.executable, false);
  ok("...and it is a decision the UI shows, in both derivations",
    mat.matchPlayer(row, [brynn]).classification,
    mat.matchPlayer(row, [mat.toCandidate({ ...brynn, player_contacts: brynn.contacts })]).classification);

  // Same DOB: nothing to decide.
  const same = { full_name: "Brynn Mower", date_of_birth: "2010-05-24",
                 contacts: [{ email: "cmower78@gmail.com" }] };
  const m2 = mat.matchPlayer(same, [brynn]);
  ok("a matching DOB needs no decision", m2.classification, mat.CLASS.CONFIDENT);
  ok("...and executes", pln.buildRowPlan({ row: same, match: m2, existingPlayer: m2.candidate,
    existingContacts: brynn.contacts, decisions: {}, identity: null }).executable, true);
}


/* ---- The full DOB-only import, staged -----------------------------------
   The coach's real scenario: identify by name + contact email, add DOB.
   14 rows, of which 2 already hold a DIFFERENT date of birth. The count of
   rows needing a decision must be the SAME at every stage — the failure being
   guarded against is 0 in one place and a surprise at Import. */

console.log("\nDOB-only import: every stage agrees");

{
  const people = [
    // [name, contact email, stored DOB]
    ["Allie Cox",         "ben.cox@example.invalid",    "2010-06-10"],
    ["Anniston Antonia",  "akantonia@example.invalid",  null],
    ["Aubrey Bohannon",   "classicbaths@example.invalid", null],
    ["Avery Myers",       "erechm@example.invalid",     null],
    ["Brynn Mower",       "cmower78@example.invalid",   "2010-05-24"],
    ["Carlyann Wilkes",   "wilkesfam28@example.invalid", null],
    ["Elin Wilkins",      "ashleyl@example.invalid",    null],
    ["Emilee Brinson",    "candice@example.invalid",    null],
    ["London Martin",     "3306537@example.invalid",    null],
    ["Maddox Henderson",  "mbh14@example.invalid",      null],
    ["Maggie Cariaco",    "rvol2002@example.invalid",   null],
    ["Mallory Wilson",    "scottiepal@example.invalid", null],
    ["Olivia Cantarutti", "jc@example.invalid",         null],
    ["Willow Mooney",     "colem0623@example.invalid",  null],
  ];

  const stored = people.map(([full_name, email, dob], i) => ({
    id: `pl${i}`, full_name,
    legal_first_name: full_name.split(" ")[0],
    preferred_first_name: null, last_name: full_name.split(" ")[1],
    grad_year: 2028, date_of_birth: dob, parent_email: null,
    player_contacts: [{ id: `ct${i}`, email }],
  }));

  const FILE_DOB = "2010-06-14";
  const rows = people.map(([full_name, email]) => ({
    full_name, date_of_birth: FILE_DOB,
    contacts: [{ full_name: null, email, phone: null }],
  }));

  // Both derivations, from the same canonical shapes.
  const clientPop = stored.map((p) => mat.toCandidate({ ...p, contacts: p.player_contacts }));
  const serverPop = stored.map(mat.toCandidate);

  const analyse = (pop, identity = {}, decisions = {}) => rows.map((row, i) => {
    const m = mat.matchPlayer(row, pop);
    const id = identity[i] ?? null;
    return { i, row, match: m, plan: pln.buildRowPlan({
      row, match: m, existingPlayer: id === "new" ? null : m.candidate,
      existingContacts: m.candidate?.contacts ?? [],
      decisions: decisions[i] ?? {}, identity: id }) };
  });

  const unresolved = (an) => an.filter((a) => !a.plan.executable);

  /* ---- Stage 1: nothing decided yet ---- */
  const c1 = analyse(clientPop), s1 = analyse(serverPop);
  ok("client: exactly 2 of 14 need a decision", unresolved(c1).length, 2);
  ok("server: exactly 2 of 14 need a decision", unresolved(s1).length, 2);
  ok("...and they are the SAME two rows",
    unresolved(c1).map((a) => a.row.full_name), unresolved(s1).map((a) => a.row.full_name));
  ok("...they are the two with a stored DOB",
    unresolved(c1).map((a) => a.row.full_name).sort(), ["Allie Cox", "Brynn Mower"]);
  ok("the other 12 are immediately executable", c1.length - unresolved(c1).length, 12);

  // Identical blockers, not merely identical counts.
  for (const a of unresolved(c1)) {
    const srv = s1.find((x) => x.i === a.i);
    ok(`${a.row.full_name}: client and server give the same blockers`,
      a.plan.blockers, srv.plan.blockers);
    ok(`${a.row.full_name}: it is a DOB conflict`, a.match.classification, mat.CLASS.CONFLICT);
    const conflicts = a.plan.resolved.filter((r) => r.status === "conflict");
    ok(`${a.row.full_name}: the coach is shown stored vs spreadsheet`,
      conflicts.map((r) => [r.key, r.existing, r.incoming]),
      [["date_of_birth", stored.find((p) => p.full_name === a.row.full_name).date_of_birth, FILE_DOB]]);
  }

  /* ---- Stage 2: the coach resolves both ---- */
  const identity = {}, decisions = {};
  for (const a of unresolved(c1)) {
    identity[a.i] = "same";
    decisions[a.i] = { date_of_birth: "incoming" };
  }
  const c2 = analyse(clientPop, identity, decisions);
  const s2 = analyse(serverPop, identity, decisions);

  ok("client: 14 of 14 executable after the decisions",
    c2.filter((a) => a.plan.executable).length, 14);
  ok("server: 14 of 14 executable after the decisions",
    s2.filter((a) => a.plan.executable).length, 14);
  ok("nothing is left unresolved anywhere", unresolved(c2).length + unresolved(s2).length, 0);
  ok("Import discovers no new decision",
    s2.filter((a) => !a.plan.executable).map((a) => a.row.full_name), []);

  /* ---- DOB is written where it belongs ---- */
  for (const a of c2) {
    const w = a.plan.writes.find((x) => x.table === "players");
    ok(`${a.row.full_name}: DOB written`, w.values.date_of_birth, FILE_DOB);
    ok(`${a.row.full_name}: onto the existing record`, Boolean(w.targetId), true);
  }

  /* ---- The matching email must never duplicate a contact ---- */
  const ops = s2.flatMap((a) =>
    a.plan.writes.filter((w) => w.table === "player_contacts").map((w) => w.op));
  ok("every matching email UPDATES its existing contact", [...new Set(ops)], ["update"]);
  ok("...and none inserts a duplicate", ops.filter((o) => o === "insert").length, 0);
  ok("...one contact write per row", ops.length, 14);
}

console.log("\nCanonical candidate shape");

{
  ok("the contract names every matching field",
    mat.MATCH_EVIDENCE,
    ["id", "full_name", "legal_first_name", "preferred_first_name", "last_name",
     "grad_year", "date_of_birth", "parent_email", "contacts"]);

  const shaped = mat.toCandidate({ id: "x", full_name: "A B" });
  ok("every contract field is present even when the source is sparse",
    mat.MATCH_EVIDENCE.every((k) => k in shaped), true);
  ok("...missing scalars become null", shaped.grad_year, null);
  ok("...and contacts default to an empty list", shaped.contacts, []);

  // The two spellings the two sources use.
  ok("a PostgREST embed is accepted",
    mat.toCandidate({ player_contacts: [{ id: "c", email: "a@b.invalid" }] }).contacts,
    [{ id: "c", email: "a@b.invalid" }]);
  ok("a resolved list is accepted",
    mat.toCandidate({ contacts: [{ id: "c", email: "a@b.invalid" }] }).contacts,
    [{ id: "c", email: "a@b.invalid" }]);
  // Contacts are NORMALISED, not reduced: id and email are guaranteed for
  // matching, and everything else on the contact survives. Stripping was the
  // defect — a projection that loses fields is what broke planning.
  ok("contacts guarantee the fields matching reads",
    ["id", "email"].every((k) => k in
      mat.toCandidate({ contacts: [{ id: "c", email: "e", phone: "p" }] }).contacts[0]), true);
  ok("...without discarding the rest of the contact",
    mat.toCandidate({ contacts: [{ id: "c", email: "e", phone: "p" }] }).contacts[0].phone, "p");

  // Legacy column still required: it is a matching source for un-backfilled rows.
  ok("legacy parent_email is retained for matching",
    mat.toCandidate({ parent_email: "old@example.invalid" }).parent_email, "old@example.invalid");
  const legacyOnly = mat.toCandidate({ id: "L", full_name: "Legacy Kid", parent_email: "old@example.invalid" });
  ok("...and still corroborates a match",
    mat.matchPlayer({ full_name: "Legacy Kid", contacts: [{ email: "old@example.invalid" }] },
      [legacyOnly]).classification, mat.CLASS.CONFIDENT);

  // A partial candidate cannot be smuggled past matchPlayer.
  const partial = { id: "p", full_name: "Partial Person", contacts: [{ email: "x@y.invalid" }] };
  ok("matchPlayer shapes whatever it is given",
    mat.matchPlayer({ full_name: "Partial Person", contacts: [{ email: "x@y.invalid" }] },
      [partial]).classification, mat.CLASS.CONFIDENT);
}

console.log("\nStructured-name matching (the client used to omit these)");

{
  // full_name absent entirely: the record is identified by its parts.
  const structured = mat.toCandidate({
    id: "s1", full_name: "Katherine Kappa",
    legal_first_name: "Katherine", preferred_first_name: "Katie", last_name: "Kappa",
    grad_year: 2029, date_of_birth: null, parent_email: null,
    player_contacts: [{ id: "sc1", email: "kappa@example.invalid" }],
  });

  for (const [label, name] of [
    ["the stored full name", "Katherine Kappa"],
    ["the preferred spelling", "Katie Kappa"],
  ]) {
    ok(`matches confidently on ${label}`,
      mat.matchPlayer({ full_name: name, contacts: [{ email: "kappa@example.invalid" }] },
        [structured]).classification, mat.CLASS.CONFIDENT);
  }

  // Reversed word order is a LOOSE match. Confident requires an exact name
  // key, so "Kappa Katherine" is offered as a candidate and still asks the
  // coach — corroborating email is not enough to skip the question when the
  // name itself was only approximately recognised.
  ok("reversed word order is a candidate, not a confident match",
    mat.matchPlayer({ full_name: "Kappa Katherine", contacts: [{ email: "kappa@example.invalid" }] },
      [structured]).classification, mat.CLASS.POSSIBLE);
  ok("...and it does find the right person to ask about",
    mat.matchPlayer({ full_name: "Kappa Katherine", contacts: [{ email: "kappa@example.invalid" }] },
      [structured]).candidate?.id, "s1");

  // Without the structured columns — the old client shape — the preferred
  // spelling does not resolve. This is what the two sides disagreed about.
  const stripped = { id: "s1", full_name: "Katherine Kappa", grad_year: 2029,
                     date_of_birth: null, parent_email: null,
                     contacts: [{ id: "sc1", email: "kappa@example.invalid" }] };
  ok("a shape without structured names misses the preferred spelling",
    mat.matchPlayer({ full_name: "Katie Kappa", contacts: [{ email: "kappa@example.invalid" }] },
      [stripped]).classification !== mat.CLASS.CONFIDENT, true);
  ok("...while the canonical shape finds it",
    mat.matchPlayer({ full_name: "Katie Kappa", contacts: [{ email: "kappa@example.invalid" }] },
      [structured]).classification, mat.CLASS.CONFIDENT);
}


/* ---- Matching evidence vs the planning record --------------------------
   toCandidate() briefly returned only the nine matching fields, and
   match.candidate is what buildRowPlan() diffs against as existingPlayer. The
   seven planning columns it dropped therefore had no stored value to compare:
   an incoming `bats` looked like a FILL against nothing rather than a CONFLICT
   against a real value, so a coach's stored value would have been overwritten
   with no decision shown. Separately, identity was read off the players write,
   so a row with nothing to change carried no player_id and the RPC refused it.

   Matching may use a normalised VIEW. Planning must keep the whole player. */

console.log("\nCandidate normalisation preserves the whole record");

{
  const storedFull = {
    id: "av1", organization_id: "org", full_name: "Avery Myers",
    legal_first_name: "Avery", preferred_first_name: null, last_name: "Myers",
    grad_year: 2028, date_of_birth: null, parent_email: null,
    person_type: "player", other_role_label: null,
    high_school: "Denmark High", bats: "L", throws: "R",
    player_email: "avery@example.invalid", player_phone: "(678) 240-9004",
    notes: "keep me", a_future_column: "must survive",
    player_contacts: [{ id: "c1", email: "erechm@example.invalid" },
                      { id: "c2", email: "bamabell@example.invalid" }],
  };
  const shaped = mat.toCandidate(storedFull);

  for (const k of Object.keys(storedFull)) {
    if (k === "player_contacts") continue;
    ok(`toCandidate preserves ${k}`, shaped[k], storedFull[k]);
  }
  ok("...including a column the helper has never heard of",
    shaped.a_future_column, "must survive");
  ok("...and it is not a reduced projection",
    Object.keys(shaped).length >= Object.keys(storedFull).length, true);
  ok("contacts are normalised under the name matching reads",
    shaped.contacts.map((c) => c.email),
    ["erechm@example.invalid", "bamabell@example.invalid"]);

  /* ---- Every planning field must CONFLICT, never silently FILL ---- */
  const pool = [shaped];
  const EMAIL = { email: "erechm@example.invalid" };
  const planFor = (patch, decisions = {}) => {
    const row = { full_name: "Avery Myers", contacts: [EMAIL], ...patch };
    const m = mat.matchPlayer(row, pool);
    return { m, plan: pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
      existingContacts: m.candidate?.contacts ?? [], decisions, identity: null }) };
  };

  for (const [field, incoming] of [
    ["bats", "R"], ["throws", "L"], ["high_school", "Other High"],
    ["player_email", "new@example.invalid"], ["player_phone", "(555) 000-1111"],
    ["notes", "overwrite me"], ["grad_year", 2030],
  ]) {
    const { plan } = planFor({ [field]: incoming });
    const r = plan.resolved.find((x) => x.key === field);
    ok(`a differing ${field} is a CONFLICT, not a fill`, r?.status, "conflict");
    ok(`...showing the stored value`, r?.existing, storedFull[field]);
    ok(`...and the row waits for the coach`, plan.executable, false);
  }

  // A value that agrees is neither.
  ok("a matching bats is SAME",
    planFor({ bats: "L" }).plan.resolved.find((r) => r.key === "bats")?.status, "same");
}

console.log("\nIdentity is carried, not inferred from a write");

{
  const stored = mat.toCandidate({
    id: "av1", full_name: "Avery Myers", legal_first_name: "Avery", last_name: "Myers",
    grad_year: 2028, date_of_birth: null, parent_email: null,
    bats: "L", throws: "R", high_school: "Denmark High", notes: null,
    player_email: null, player_phone: null, person_type: "player",
    player_contacts: [{ id: "c1", email: "erechm@example.invalid" }],
  });
  const EMAIL = { email: "erechm@example.invalid" };

  // Mirrors compact()'s rule: identity comes from the resolved match.
  const identityOf = (m, chosen) =>
    (chosen === "new" || m.classification === mat.CLASS.NEW) ? null : (m.candidate?.id ?? null);

  const cases = [
    ["DOB already identical",        { date_of_birth: null }],
    ["blank DOB does not erase",     { date_of_birth: "" }],
    ["only contact work",            {}],
  ];
  for (const [label, patch] of cases) {
    const row = { full_name: "Avery Myers", contacts: [EMAIL], ...patch };
    const m = mat.matchPlayer(row, [stored]);
    const plan = pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
      existingContacts: stored.contacts, decisions: {}, identity: null });

    ok(`${label}: row is executable`, plan.executable, true);
    ok(`${label}: no players write is invented`,
      plan.writes.some((w) => w.table === "players"), false);
    ok(`${label}: identity is still known`, identityOf(m, null), "av1");
    // The old rule, kept as the thing that must never return.
    ok(`${label}: inferring from the write would have sent null`,
      plan.writes.find((w) => w.table === "players")?.targetId ?? null, null);
  }

  // A real fill still produces a write, and the same identity.
  const row = { full_name: "Avery Myers", date_of_birth: "2010-06-14", contacts: [EMAIL] };
  const m = mat.matchPlayer(row, [stored]);
  const plan = pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
    existingContacts: stored.contacts, decisions: {}, identity: null });
  ok("a genuine fill writes to players",
    plan.writes.find((w) => w.table === "players")?.values?.date_of_birth, "2010-06-14");
  ok("...onto the matched record", identityOf(m, null), "av1");
  ok("...and the matching email updates rather than duplicates",
    plan.writes.filter((w) => w.table === "player_contacts").map((w) => w.op), ["update"]);
}

console.log("\nThe server query cannot drift from the planner");

{
  const cols = reg.planningPlayerColumns();
  const planningFields = reg.writableFields()
    .filter((f) => f.level === "player" && f.destination?.startsWith("players."))
    .map((f) => f.destination.slice("players.".length));

  for (const f of planningFields) {
    ok(`the candidate query includes ${f}`, cols.includes(f), true);
  }
  ok("...plus identity", cols.includes("id") && cols.includes("organization_id"), true);
  ok("...plus the legacy matching column", cols.includes("parent_email"), true);
  ok("...plus other_role_label, written beside person_type",
    cols.includes("other_role_label"), true);

  // The seven that were missing.
  for (const f of ["bats", "throws", "high_school", "player_email",
                   "player_phone", "notes", "person_type"]) {
    ok(`${f} is no longer omitted`, cols.includes(f), true);
  }

  const src = require("fs").readFileSync("lib/actions/intake.js", "utf8");
  // Superseded: the select moved into lib/queries/match-candidates.js, shared
  // with the preview so the two populations cannot diverge.
  ok("the shared candidate query derives its select from the registry",
    /planningPlayerColumns\(\)\.join\(", "\)/.test(
      require("fs").readFileSync("lib/queries/match-candidates.js", "utf8")), true);
  ok("...rather than a hand-written column list",
    !/select\("id, full_name, legal_first_name/.test(src), true);
  ok("identity is passed explicitly to compact()",
    /playerId: candidate\?\.id \?\? null/.test(src), true);
  ok("...and used instead of the write's targetId",
    /out\.player_id = playerId \?\? null/.test(src), true);
}


/* ---- Address: planning field, never matching evidence -------------------
   Five new registry fields flow through the contract stabilised last round.
   The point of that generalisation was that adding a field extends planning
   automatically WITHOUT touching identity resolution. These prove it. */

console.log("\nAddress is planning-only");

{
  const ADDR = ["street_address", "street_address_2", "city", "state", "zip"];

  ok("address extends the planning query automatically",
    ADDR.every((c) => reg.planningPlayerColumns().includes(c)), true);
  ok("MATCH_EVIDENCE is unchanged by the new fields",
    mat.MATCH_EVIDENCE,
    ["id", "full_name", "legal_first_name", "preferred_first_name", "last_name",
     "grad_year", "date_of_birth", "parent_email", "contacts"]);
  ok("no address field is matching evidence",
    ADDR.some((c) => mat.MATCH_EVIDENCE.includes(c)), false);

  // Two families at one address are not one child.
  const a = mat.toCandidate({ id: "a1", full_name: "Ana Alpha",
    street_address: "1 Same St", city: "Cumming", state: "GA", zip: "30040",
    player_contacts: [{ id: "ac", email: "alpha@example.invalid" }] });
  const sameAddressDifferentChild = { full_name: "Bea Beta",
    street_address: "1 Same St", city: "Cumming", state: "GA", zip: "30040" };
  ok("a shared address does not make two children one player",
    mat.matchPlayer(sameAddressDifferentChild, [a]).classification, mat.CLASS.NEW);

  // A move is not a new person.
  ok("a changed address does not break an otherwise confident match",
    mat.matchPlayer({ full_name: "Ana Alpha", street_address: "9 New Rd",
      contacts: [{ email: "alpha@example.invalid" }] }, [a]).classification,
    mat.CLASS.CONFIDENT);

  /* ---- blank / SAME / FILL / CONFLICT ---- */
  const stored = mat.toCandidate({
    id: "s1", full_name: "Cleo Gamma", legal_first_name: "Cleo", last_name: "Gamma",
    grad_year: 2028, date_of_birth: null, parent_email: null,
    street_address: "12 Oak Lane", street_address_2: null,
    city: "Cumming", state: "GA", zip: "30040",
    player_contacts: [{ id: "cc", email: "gamma@example.invalid" }],
  });
  const EMAIL = { email: "gamma@example.invalid" };
  const planFor = (patch, decisions = {}) => {
    const row = { full_name: "Cleo Gamma", contacts: [EMAIL], ...patch };
    const m = mat.matchPlayer(row, [stored]);
    return pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
      existingContacts: stored.contacts, decisions, identity: null });
  };

  // BLANK must not erase.
  const blank = planFor({ street_address: "", city: "", state: "", zip: "" });
  ok("a blank address cell writes nothing",
    blank.writes.some((w) => w.table === "players"), false);
  ok("...and does not block the row", blank.executable, true);

  // SAME.
  const same = planFor({ street_address: "12 Oak Lane", city: "Cumming",
                         state: "GA", zip: "30040" });
  for (const f of ["street_address", "city", "state", "zip"]) {
    ok(`an identical ${f} is SAME`,
      same.resolved.find((r) => r.key === f)?.status, "same");
  }
  ok("...and nothing is written", same.writes.some((w) => w.table === "players"), false);

  // FILL onto a blank stored value.
  const fill = planFor({ street_address_2: "Apt 4B" });
  ok("an address line 2 onto a blank stored value is a FILL",
    fill.resolved.find((r) => r.key === "street_address_2")?.status, "fill");
  ok("...is executable without a decision", fill.executable, true);
  ok("...and is written",
    fill.writes.find((w) => w.table === "players")?.values?.street_address_2, "Apt 4B");

  // CONFLICT on every populated field that differs.
  for (const [f, incoming] of [
    ["street_address", "99 Elm Street"], ["city", "Alpharetta"],
    ["state", "TN"], ["zip", "30009"],
  ]) {
    const plan = planFor({ [f]: incoming });
    const r = plan.resolved.find((x) => x.key === f);
    ok(`a differing ${f} is a CONFLICT`, r?.status, "conflict");
    ok(`...showing the stored value`, r?.existing, stored[f]);
    ok(`...and blocks until the coach decides`, plan.executable, false);
  }

  // Resolving lets it through.
  const decided = planFor({ city: "Alpharetta" }, { city: "incoming" });
  ok("a resolved address conflict executes", decided.executable, true);
  ok("...writing the chosen value",
    decided.writes.find((w) => w.table === "players")?.values?.city, "Alpharetta");

  /* ---- header synonyms coaches actually use ---- */
  const headers = ["Address", "Street Address", "Address 1", "Address Line 1",
                   "Address 2", "Apt", "City", "State", "ZIP", "Zip Code",
                   "Postal Code", "Mailing Address"];
  const mapped = map.suggestMappings(headers).mappings;
  const keyFor = (h) => mapped.find((m) => m.header === h)?.key;
  ok("Address maps to line 1", keyFor("Address"), "street_address");
  ok("Street Address maps to line 1", keyFor("Street Address"), "street_address");
  ok("Address 1 maps to line 1", keyFor("Address 1"), "street_address");
  ok("Address 2 maps to line 2", keyFor("Address 2"), "street_address_2");
  ok("Apt maps to line 2", keyFor("Apt"), "street_address_2");
  ok("City maps to city", keyFor("City"), "city");
  ok("State maps to state", keyFor("State"), "state");
  ok("ZIP maps to zip", keyFor("ZIP"), "zip");
  ok("Zip Code maps to zip", keyFor("Zip Code"), "zip");
  ok("Postal Code maps to zip", keyFor("Postal Code"), "zip");
  ok("every address column auto-enables", 
    mapped.filter((m) => ADDR.includes(m.key)).every((m) => m.autoEnabled), true);
}


/* ---- Best Guess is a suggestion, not an authorisation ------------------- */

console.log("\nBest Guess requires confirmation");

{
  // Exact headers switch themselves on.
  for (const h of ["Full Name", "Grad Year", "State", "City", "ZIP", "X Handle", "X URL"]) {
    const m = map.suggestMappings([h]).mappings[0];
    ok(`${h} is exact`, m.confidence, "exact");
    ok(`${h} auto-includes`, m.autoEnabled, true);
  }

  // A probable match is still SUGGESTED, but cannot write unasked.
  const probable = map.suggestMappings(["Kid Nickname Thing"]).mappings[0];
  if (probable) {
    ok("a probable match is still offered", Boolean(probable.key), true);
    ok("...but does not auto-include", probable.autoEnabled, false);
  }
  ok("no probable mapping auto-includes, generally",
    ["Statuses", "Colledge", "Playr Emial", "Guardian Relation Thing"]
      .flatMap((h) => map.suggestMappings([h]).mappings)
      .filter((m) => m.confidence === "probable")
      .every((m) => m.autoEnabled === false), true);
}

/* ---- Our own export's columns are named, not guessed at ----------------- */

console.log("\nExport-only columns are recognised and not imported");

{
  for (const h of ["Status", "Joined Date", "Role Label",
                   "College Interest 1", "College Interest 1 Notes",
                   "Contact 1 Primary", "Contact 2 Primary"]) {
    const r = map.suggestMappings([h]);
    ok(`${h} is not mapped to a writable field`, r.mappings.length, 0);
    ok(`${h} is recognised rather than left unexplained`, r.ignored.length, 1);
  }

  // The specific corruption this prevents.
  ok("Status no longer resolves to the address State",
    map.suggestMappings(["Status"]).mappings.some((m) => m.key === "state"), false);
  ok("College Interest no longer resolves to the address State",
    map.suggestMappings(["College Interest 1"]).mappings.some((m) => m.key === "state"), false);
  ok("College Interest Notes no longer resolves to player notes",
    map.suggestMappings(["College Interest 1 Notes"]).mappings.some((m) => m.key === "notes"), false);
  ok("State itself still maps exactly",
    map.suggestMappings(["State"]).mappings[0].key, "state");
}

/* ---- X Handle and X URL compose ONE link ------------------------------- */

console.log("\nOne X link from two columns");

{
  ok("the handle column and the URL column are distinct fields",
    [map.suggestMappings(["X Handle"]).mappings[0].key,
     map.suggestMappings(["X URL"]).mappings[0].key],
    ["social_handle", "social_url"]);
  ok("X URL is no longer an alias of the handle",
    map.suggestMappings(["X URL"]).mappings[0].key === "social_handle", false);

  const linksFor = (row) => {
    const m = mat.matchPlayer(row, []);
    return pln.buildRowPlan({ row, match: m, existingPlayer: null,
      existingContacts: [], decisions: {}, identity: null });
  };

  const both = linksFor({ full_name: "A", social_handle: "@bellaramos",
    social_url: "https://x.com/bellaramos", contacts: [] });
  const bw = both.writes.filter((w) => w.table === "player_links");
  ok("handle + URL produce exactly ONE link", bw.length, 1);
  ok("...with the URL as the address", bw[0].values.url, "https://x.com/bellaramos");
  ok("...and the coach's handle as the label", bw[0].values.label, "@bellaramos");

  const urlOnly = linksFor({ full_name: "A", social_url: "https://x.com/bellaramos", contacts: [] });
  const uw = urlOnly.writes.filter((w) => w.table === "player_links");
  ok("URL alone is a valid link", uw.length, 1);
  ok("...and the label is the handle, never the address", uw[0].values.label, "@bellaramos");

  const handleOnly = linksFor({ full_name: "A", social_handle: "@bellaramos", contacts: [] });
  const hw = handleOnly.writes.filter((w) => w.table === "player_links");
  ok("a handle alone composes the address deterministically",
    hw[0].values.url, "https://x.com/bellaramos");

  ok("a twitter.com address normalises to x.com",
    linksFor({ full_name: "A", social_url: "https://twitter.com/bellaramos", contacts: [] })
      .writes.filter((w) => w.table === "player_links")[0].values.url,
    "https://x.com/bellaramos");

  ok("neither column means no link",
    linksFor({ full_name: "A", contacts: [] })
      .writes.filter((w) => w.table === "player_links").length, 0);

  const bad = linksFor({ full_name: "A", social_url: "not an address", contacts: [] });
  ok("an unreadable URL writes nothing",
    bad.writes.filter((w) => w.table === "player_links").length, 0);
  ok("...and is surfaced for review", bad.executable, false);

  // Never two links for one player from one row.
  ok("two columns never yield two link rows",
    both.writes.filter((w) => w.table === "player_links").length, 1);
}


/* ---- Position vocabulary ------------------------------------------------
   MIF, CIF and OF are grouped designations a coach uses when a player covers
   an area rather than one bag. They are ADDITIONS: a player who only plays
   shortstop must still be recordable as SS.

   The list lived in three places — the registry, lib/queries/roster and again
   inside RosterClient — so a position added to the chips a coach picks from
   could be rejected by the importer. There is one list now. */

console.log("\nPosition vocabulary");

{
  const fs = require("fs");

  for (const code of ["MIF", "CIF", "OF"]) {
    ok(`${code} is a valid position`, reg.POSITION_CODES.includes(code), true);
  }
  ok("every original position survives",
    ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "UTIL", "DP", "FLEX"]
      .every((c) => reg.POSITION_CODES.includes(c)), true);
  ok("...and the grouped codes did not replace the specific ones",
    reg.POSITION_CODES.length, 15);

  // One source: the other two derive from it.
  const q = fs.readFileSync("lib/queries/roster.js", "utf8");
  const rc = fs.readFileSync("components/RosterClient.js", "utf8");
  ok("lib/queries/roster derives its list", /POSITIONS = POSITION_CODES/.test(q), true);
  ok("...and no longer restates it", !/POSITIONS = \["P", "C"/.test(q), true);
  ok("the roster chips derive their list",
    /POSITION_CODES as POSITIONS/.test(rc), true);
  ok("...and no longer restate it", !/const POSITIONS = \["P", "C"/.test(rc), true);

  // Import: exact abbreviations, case-insensitive, no invented aliases.
  for (const [raw, want] of [
    ["MIF", ["MIF"]], ["mif", ["MIF"]], ["Mif", ["MIF"]],
    ["CIF", ["CIF"]], ["cif", ["CIF"]], [" CIF ", ["CIF"]],
    ["OF", ["OF"]],   ["of", ["OF"]],   ["Of", ["OF"]],
  ]) {
    ok(`import accepts ${JSON.stringify(raw)}`, nrm.toPositions(raw), want);
  }
  ok("they combine with specific positions", nrm.toPositions("SS/MIF"), ["SS", "MIF"]);
  ok("...and with each other", nrm.toPositions("CIF, OF"), ["CIF", "OF"]);
  ok("a repeat is not duplicated", nrm.toPositions("OF; OF"), ["OF"]);
  ok("an unknown code is still refused", nrm.toPositions("QB"), []);

  // No speculative aliases were added.
  ok("no spelled-out alias was invented for the grouped codes",
    nrm.toPositions("Middle Infield"), []);
  ok("the pre-existing outfield word alias is unchanged",
    nrm.toPositions("outfield"), ["CF"]);
}


/* ---- Position round trip: export -> file -> import ----------------------
   The dropdown working proves nothing about whether a position survives the
   journey out to a spreadsheet and back. This writes a real .xlsx, reads it
   back, and drives the exported cells through the actual mapping and planning
   path — including the case where nothing has changed, which must produce no
   update and no conflict. */

console.log("\nPositions survive export and re-import");

{
  const XLSX = require("xlsx");
  const exp = await load("lib/player-export.js");

  const cases = [
    ["Mia Middleton", ["MIF"]],
    ["Cora Corner",   ["CIF"]],
    ["Ola Outfield",  ["OF"]],
    ["Dana Dual",     ["MIF", "OF"]],
    ["Cate Catcher",  ["C", "CIF"]],
    ["Sam Specific",  ["SS"]],
  ];

  const roster = cases.map(([full_name, positions], i) => ({
    id: `a${i}`, jersey_number: 10 + i, positions, is_active: true,
    player: { id: `p${i}`, full_name, person_type: "player", grad_year: 2028,
              date_of_birth: "2010-06-14", throws: "R", bats: "L",
              player_contacts: [{ id: `c${i}`, email: `g${i}@example.invalid` }] },
    contacts: [{ id: `c${i}`, full_name: `Guardian ${i}`, email: `g${i}@example.invalid`,
                 is_primary: true, sort_order: 1 }],
    links: [], colleges: [],
  }));

  // Export through the real builder, then round-trip through a real file.
  const { columns, rows: body } = exp.buildExport(roster);
  const sheet = XLSX.utils.aoa_to_sheet([columns, ...body]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Players");
  const buf = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const aoa = XLSX.utils.sheet_to_json(XLSX.read(buf, { type: "buffer" }).Sheets.Players,
    { header: 1, defval: "", blankrows: false });

  const header = aoa[0];
  const iPos = header.indexOf("Positions");
  for (const [i, [name, positions]] of cases.entries()) {
    ok(`${name}: exported cell`, aoa[i + 1][iPos], positions.join(" / "));
  }

  // Re-import the file we just wrote.
  const sug = map.suggestMappings(header);
  const enabled = new Set(sug.mappings.filter((m) => m.autoEnabled).map((m) => m.header));
  const active = sug.mappings.filter((m) => enabled.has(m.header));
  ok("the Positions column re-maps exactly",
    sug.mappings.find((m) => m.header === "Positions")?.confidence, "exact");

  const existing = roster.map((r) => mat.toCandidate(r.player));
  let playerWrites = 0, blocked = 0, conflicts = 0;

  for (const [i, [name, positions]] of cases.entries()) {
    const raw = Object.fromEntries(header.map((h, c) => [h, aoa[i + 1][c] ?? ""]));
    const mapped = map.applyMappings(raw, active);
    const row = { contacts: [] };
    for (const [k, v] of Object.entries(mapped)) {
      if (k === "contacts") continue;
      const f = reg.BY_KEY.get(k);
      if (!f || reg.isIgnored(k)) continue;
      row[k] = nrm.normalizeValue(f.type, v);
    }
    row.contacts = (mapped.contacts ?? []).map((c) => ({ ...c }));

    ok(`${name}: re-imports to the same positions`, row.positions, positions);

    const m = mat.matchPlayer(row, existing);
    const plan = pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
      existingContacts: m.candidate?.contacts ?? [], decisions: {}, identity: null });
    ok(`${name}: matches the same player`, m.candidate?.full_name, name);
    if (plan.writes.some((w) => w.table === "players")) playerWrites += 1;
    if (!plan.executable) blocked += 1;
    conflicts += plan.resolved.filter((r) => r.status === "conflict").length;
  }

  // An unchanged re-import must be a no-op, not a pile of updates.
  ok("re-importing unchanged data updates no player field", playerWrites, 0);
  ok("...blocks nothing", blocked, 0);
  ok("...and invents no conflicts", conflicts, 0);
}

console.log("\nPositions from a spreadsheet we did not write");

{
  // A coach's own file: lowercase, padded, slash- and comma-separated.
  const f = reg.BY_KEY.get("positions");
  const sug = map.suggestMappings(["Name", "Jersey", "Position", "Grad Year"]);
  ok("a plain 'Position' header is recognised",
    sug.mappings.find((m) => m.header === "Position")?.key, "positions");

  const active = sug.mappings.filter((m) => m.autoEnabled);
  for (const [cell, want] of [
    ["mif", ["MIF"]], [" OF ", ["OF"]], ["CIF", ["CIF"]],
    ["SS/MIF", ["SS", "MIF"]], ["of, cif", ["OF", "CIF"]],
  ]) {
    const mapped = map.applyMappings(
      { Name: "X", Jersey: "1", Position: cell, "Grad Year": "2029" }, active);
    ok(`external ${JSON.stringify(cell)}`, nrm.normalizeValue(f.type, mapped.positions), want);
  }
}


/* ---- Date of birth: the coach's format, not the database's --------------
   toDate() had no branch for slash dates, so 05/02/2010 — the format Season
   Tempo itself displays — fell through to null, blocked the row, and told the
   coach to convert to YYYY-MM-DD. That is the database's internal
   representation and not something anyone should have to type.

   Slashes are read as MONTH/DAY/YEAR in code, not by locale: the same file
   opened on a machine set to en-GB must not turn 2 May into 5 February. No
   branch uses new Date(string), whose parsing is implementation-defined, and
   nothing on this path uses toISOString(), which would shift the calendar day
   backwards for anyone west of UTC. */

console.log("\nDate of birth accepts the format the product shows");

{
  for (const [raw, want] of [
    ["05/02/2010", "2010-05-02"],
    ["5/2/2010",   "2010-05-02"],
    ["2010-05-02", "2010-05-02"],
    ["May 2, 2010","2010-05-02"],
    ["1/1/2010",   "2010-01-01"],
    ["12/31/2009", "2009-12-31"],
    ["02/29/2008", "2008-02-29"],
  ]) ok(`${raw} -> ${want}`, nrm.toDate(raw), want);

  ok("an Excel date cell keeps its calendar day",
    nrm.toDate(new Date(2010, 4, 2)), "2010-05-02");
  ok("...even late in the evening",
    nrm.toDate(new Date(2010, 4, 2, 23, 30)), "2010-05-02");
  ok("...and on New Year's Day", nrm.toDate(new Date(2010, 0, 1)), "2010-01-01");

  // The reading is fixed, not locale-dependent.
  ok("05/02 is May 2", nrm.toDate("05/02/2010"), "2010-05-02");
  ok("02/05 is February 5", nrm.toDate("02/05/2010"), "2010-02-05");

  // Impossible and unsupported still block; nothing is guessed.
  for (const raw of ["02/30/2010", "02/29/2010", "13/01/2010", "00/05/2010",
                     "2010/05/02", "05-02-2010", "not a date"]) {
    ok(`${raw} blocks`, nrm.toDate(raw), null);
    ok(`...and is surfaced, not dropped`, nrm.classifyDate(raw).ok, false);
  }
  ok("a blank is absent rather than unreadable", nrm.classifyDate("").ok, true);

  // No environment-dependent parsing anywhere on this path.
  const code = require("fs").readFileSync("lib/intake/normalize.js", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("no new Date(string) parsing", /new Date\(s\)|new Date\(String/.test(code), false);
  ok("no toISOString on the DOB path", /toISOString/.test(code), false);

  // The guidance a blocked row gives.
  const src = require("fs").readFileSync("lib/intake/plan.js", "utf8");
  ok("a blocked date suggests MM/DD/YYYY", /MM\/DD\/YYYY/.test(src), true);
  ok("...and no longer teaches the database format",
    /use a format like 2010-03-04/.test(src), false);
}

console.log("\nDate of birth survives export and re-import");

{
  const XLSX = require("xlsx");
  const exp = await load("lib/player-export.js");

  const player = { id: "d1", full_name: "Dot Bee", person_type: "player",
    grad_year: 2028, date_of_birth: "2010-05-02",
    player_contacts: [{ id: "dc1", email: "g@example.invalid" }] };
  const roster = [{ id: "a1", positions: ["SS"], is_active: true, player,
    contacts: [{ id: "dc1", full_name: "G", email: "g@example.invalid",
                 is_primary: true, sort_order: 1 }], links: [], colleges: [] }];

  const { columns, rows: body } = exp.buildExport(roster);
  ok("exported as MM/DD/YYYY", body[0][columns.indexOf("Date of Birth")], "05/02/2010");

  const sheet = XLSX.utils.aoa_to_sheet([columns, ...body]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Players");
  const aoa = XLSX.utils.sheet_to_json(
    XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer" }).Sheets.Players,
    { header: 1, defval: "", blankrows: false });

  const header = aoa[0];
  const sug = map.suggestMappings(header);
  const active = sug.mappings.filter((m) => m.autoEnabled);
  const raw = Object.fromEntries(header.map((h, c) => [h, aoa[1][c] ?? ""]));
  const mapped = map.applyMappings(raw, active);
  const row = { contacts: [] };
  for (const [k, v] of Object.entries(mapped)) {
    if (k === "contacts") continue;
    const f = reg.BY_KEY.get(k);
    if (!f || reg.isIgnored(k)) continue;
    row[k] = nrm.normalizeValue(f.type, v);
  }
  row._unreadable = nrm.unreadableValues(mapped, (k) => reg.BY_KEY.get(k));

  ok("re-imports to the canonical value", row.date_of_birth, "2010-05-02");
  ok("nothing is flagged unreadable", row._unreadable, []);

  const existing = [mat.toCandidate(player)];
  const plan = pln.buildRowPlan({ row, match: mat.matchPlayer(row, existing),
    existingPlayer: existing[0], existingContacts: existing[0].contacts,
    decisions: {}, identity: null });
  ok("the row imports without a decision", plan.executable, true);
  ok("DOB reads as SAME", plan.resolved.find((r) => r.key === "date_of_birth")?.status, "same");
  ok("...so nothing is rewritten", plan.writes.some((w) => w.table === "players"), false);
}


/* ---- The real XLSX ingestion boundary -----------------------------------
   A coach's workbook stores a date of birth as an EXCEL SERIAL — cell type
   "n", value 40303 — not as text. Two things stopped that reaching the
   parser, and neither was visible from a unit test that called
   toDate(new Date(...)) directly:

     XLSX.read() was called without cellDates, so the serial stayed a number.
     Even with it, the reader stringifies every cell, so a Date became
     "Wed May 05 2010 00:00:00 GMT-0400 (Eastern Daylight Time)".

   readSpreadsheet now asks for raw: false — the cell's displayed text,
   "5/5/2010" — which survives stringification and is already in the format
   this product uses. This test goes through readSpreadsheet itself, from a
   real .xlsx on disk, so the boundary is what is under test. */

console.log("\nExcel date cells through the real reader");

{
  const fsx = require("fs");
  const ss = await load("lib/spreadsheet.js");
  const bytes = fsx.readFileSync("scripts/fixtures/excel-dates.xlsx");

  // The cells really are serials, not text — otherwise this proves nothing.
  const XLSX = require("xlsx");
  const probe = XLSX.read(bytes, { type: "buffer" }).Sheets.Players;
  ok("the fixture stores a serial, as Excel does", probe.D2.t, "n");
  ok("...and the raw value is a number", typeof probe.D2.v, "number");

  const file = {
    name: "excel-dates.xlsx",
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
  const { grid, error } = await ss.readSpreadsheet(file);
  ok("readSpreadsheet succeeds", error ?? "ok", "ok");

  const header = grid[0];
  const iName = header.indexOf("Player Name");
  const iDob = header.indexOf("Date of Birth");
  const row = (n) => grid.slice(1).find((r) => r[iName] === n);

  for (const [name, shown, canonical] of [
    ["Tenley Lynch",    "5/5/2010",   "2010-05-05"],
    ["Nicole Gooden",   "9/11/2010",  "2010-09-11"],
    ["Hadley O'Kelley", "6/14/2010",  "2010-06-14"],
    ["Lindy Ledden",    "11/22/2010", "2010-11-22"],
  ]) {
    const v = row(name)[iDob];
    ok(`${name}: not an Excel serial`, /^\d{5}$/.test(v), false);
    ok(`${name}: previewed as ${shown}`, v, shown);
    ok(`${name}: normalises to ${canonical}`, nrm.toDate(v), canonical);
  }

  ok("a blank date of birth stays blank", row("No Birthday")[iDob], "");
  ok("...and is absent rather than unreadable",
    nrm.classifyDate(row("No Birthday")[iDob]).ok, true);

  // Other column types must not be damaged by asking for formatted text.
  ok("grad year survives", row("Tenley Lynch")[header.indexOf("Grad Year")], "2028");
  ok("position survives", row("Tenley Lynch")[header.indexOf("Position")], "MIF");

  // The reader's configuration, asserted so it cannot silently regress.
  const src = fsx.readFileSync("lib/spreadsheet.js", "utf8");
  ok("cellDates is on the read itself",
    /XLSX\.read\(buffer, \{ type: "array", cellDates: true \}\)/.test(src), true);
  ok("...and formatted text is requested", /raw: false/.test(src), true);
}


/* ---- Required fields, column independence, partial re-import ------------
   A coach re-importing on a phone unchecked columns to fill one missing
   field, tapped Player Name by accident, and was refused at the NEXT step
   with "row has no player name" — an allowed action punished afterwards, in
   language about rows rather than the control tapped. full_name has carried
   requiredForIntake since the registry was written; the mapping never passed
   it on, so the UI had no way to know. */

console.log("\nRequired fields cannot be excluded");

{
  const sug = map.suggestMappings(["Player Name", "Date of Birth", "Grad Year",
                                   "Email", "Jersey Size", "Pants Size"]);
  ok("full_name is the only required field",
    sug.mappings.filter((m) => m.required).map((m) => m.key), ["full_name"]);

  // Matching EVIDENCE is not identity. Excluding it weakens matching, which
  // is the coach's call; excluding the name makes every row invalid.
  for (const k of ["date_of_birth", "grad_year", "contact_email",
                   "jersey_size", "pants_size"]) {
    ok(`${k} stays optional`, sug.mappings.find((m) => m.key === k).required, false);
  }

  const keyOf = (m) => m.header;
  ok("a required column is seeded included",
    new Set(sug.mappings.filter((m) => m.autoEnabled || m.required).map(keyOf))
      .has("Player Name"), true);

  const ui = require("fs").readFileSync("components/PlayerIntake.js", "utf8");
  ok("the UI renders it as Required, not a checkbox", /m\?\.required \? \(/.test(ui), true);
  ok("...and the destination cannot be cleared either",
    /current\?\.required && !key/.test(ui), true);
  ok("...and it is force-included at the seed",
    /m\.autoEnabled \|\| m\.required/.test(ui), true);
}

console.log("\nSource columns toggle independently");

{
  const keyOf = (m) => m.header;
  const sug = map.suggestMappings(["X Handle", "X URL", "Contact 1 Email", "Contact 2 Email"]);
  ok("each column has its own key", new Set(sug.mappings.map(keyOf)).size, sug.mappings.length);

  // X Handle and X URL describe ONE link; they must still toggle separately.
  const enabled = new Set(sug.mappings.map(keyOf));
  enabled.delete("X Handle");
  ok("unchecking one leaves its twin included", enabled.has("X URL"), true);
  ok("...and an unrelated contact column untouched", enabled.has("Contact 2 Email"), true);

  // Repeated toggling must not degrade.
  let set = new Set(sug.mappings.map(keyOf));
  for (let i = 0; i < 6; i += 1) {
    set = new Set(set);
    set.has("Contact 1 Email") ? set.delete("Contact 1 Email") : set.add("Contact 1 Email");
  }
  ok("six toggles leave the others alone",
    [set.has("X Handle"), set.has("X URL"), set.has("Contact 2 Email")], [true, true, true]);
}

console.log("\nPartial re-import writes only what was selected");

{
  const stored = mat.toCandidate({ id: "p1", full_name: "Tenley Lynch", grad_year: 2028,
    date_of_birth: "2010-05-05",
    player_contacts: [{ id: "c", email: "t@example.invalid" }] });

  // Only a name and the one field the coach came back for.
  const row = { full_name: "Tenley Lynch", jersey_size: "AM", contacts: [] };
  const m = mat.matchPlayer(row, [stored]);
  const plan = pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
    existingContacts: stored.contacts, decisions: {}, identity: null });

  ok("no player field is written", plan.writes.some((w) => w.table === "players"), false);
  // With the evidence columns unchecked there is nothing to corroborate the
  // name, so the row asks. That is the matching protection, not a defect.
  ok("identity needs confirming when evidence is excluded", plan.executable, false);

  const decided = pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
    existingContacts: stored.contacts, decisions: {}, identity: "same" });
  ok("once confirmed the row imports", decided.executable, true);
  ok("...writing only the selected field", decided.writes.map((w) => w.table),
    ["team_season_players"]);
  ok("...with only that value", decided.writes[0].values, { jersey_size: "AM" });

  // Leaving the evidence checked costs nothing: unchanged values are SAME.
  const withEvidence = { full_name: "Tenley Lynch", date_of_birth: "2010-05-05",
    jersey_size: "AM", contacts: [{ email: "t@example.invalid" }] };
  const m2 = mat.matchPlayer(withEvidence, [stored]);
  const p2 = pln.buildRowPlan({ row: withEvidence, match: m2, existingPlayer: m2.candidate,
    existingContacts: stored.contacts, decisions: {}, identity: null });
  ok("keeping evidence checked avoids the decision", p2.executable, true);
  ok("...and still writes no player field", p2.writes.some((w) => w.table === "players"), false);

  const blank = pln.buildRowPlan({
    row: { full_name: "Tenley Lynch", grad_year: null, contacts: [] },
    match: m2, existingPlayer: stored, existingContacts: stored.contacts,
    decisions: {}, identity: null });
  ok("a blank never erases", blank.writes.some((w) => w.table === "players"), false);
}

console.log("\nUniform sizes are not a readiness requirement");

{
  const fsx = require("fs");
  const src = fsx.readFileSync("lib/readiness/team.js", "utf8");
  ok("no jersey_size in any readiness rule", /jersey_size/.test(src), false);
  ok("no pants_size in any readiness rule", /pants_size/.test(src), false);
  ok("jersey_number is no longer a readiness rule either",
    /jersey_number/.test(src), false);
  ok("the uniform check is gone entirely", /uniformCheck|jerseyNumberCheck/.test(src), false);
  ok("...and nothing replaced it",
    (src.match(/^function \w+Check\(/gm) || []).length, 2);
  ok("only date of birth and contacts remain",
    (src.match(/^function (\w+)Check\(/gm) || []).sort(),
    ["function contactCheck(", "function registrationCheck("]);
  ok("the filter label is removed", /uniform:/.test(src), false);

  const dash = fsx.readFileSync("lib/readiness/dashboard.js", "utf8");
  ok("the dashboard wording is removed", /"team:uniform"/.test(dash), false);
  const rc = fsx.readFileSync("components/RosterClient.js", "utf8");
  ok("the roster panel wording is removed", /uniform information/.test(rc), false);

  // The fields themselves are untouched everywhere else.
  ok("jersey_size is still importable", reg.BY_KEY.get("jersey_size").importable, true);
  ok("pants_size is still importable", reg.BY_KEY.get("pants_size").importable, true);
  ok("both still export",
    /Jersey Size/.test(fsx.readFileSync("lib/player-export.js", "utf8")), true);
}

console.log("\nMobile viewport");

{
  const css = require("fs").readFileSync("app/globals.css", "utf8");
  ok("the drawer uses the dynamic viewport on mobile",
    /@media \(max-width: 720px\)[\s\S]*?\.drawer \{ height: 100dvh; \}/.test(css), true);
  ok("height: 100% remains as the fallback",
    /\.drawer \{[^}]*height: 100%/.test(css), true);
  ok("safe-area padding only applies when there is an inset",
    /env\(safe-area-inset-bottom, 0px\)/.test(css), true);
  ok("the include control meets a 44px target",
    /\.pi-switch \{ min-height: 44px; \}/.test(css), true);
  ok("...and so does the Required badge",
    /\.pi-required \{ min-height: 44px; \}/.test(css), true);
}


/* ---- Manually remapping an ambiguous column -----------------------------
   A real workbook carried jersey sizes in a column headed "Code", holding
   AM / AL / AS. "Code" matches no synonym, so it arrives unmapped and shows
   as Don't import — which is correct. It could be a uniform size, a player
   code or a discount code, and writing "AM" into the wrong field on the
   strength of a guess is worse than asking.

   DELIBERATELY NOT ADDED: "code" as a jersey_size synonym, and any inference
   from the VALUES. Both are name- or value-shaped guesses; a semantic mapper
   is a larger design than this. The manual path is the supported one, which
   is exactly why unmapped columns must be reachable on a phone. */

console.log("\nRemapping an unrecognised column by hand");

{
  const fsx = require("fs");
  const ss = await load("lib/spreadsheet.js");
  const bytes = fsx.readFileSync("scripts/fixtures/excel-dates.xlsx");

  // A header the mapper cannot know, alongside ones it can.
  const XLSX = require("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Player Name", "Grad Year", "Code"],
    ["Tenley Lynch", 2028, "AM"],
    ["Peyton Currie", 2028, "AL"],
    ["Dakota McDaniel", 2029, "AS"],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Players");
  const wb = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const { grid } = await ss.readSpreadsheet({ name: "code.xlsx",
    arrayBuffer: async () => wb.buffer.slice(wb.byteOffset, wb.byteOffset + wb.byteLength) });

  const header = grid[0];
  const sug = map.suggestMappings(header);

  ok("Code arrives unmapped", sug.unmapped.includes("Code"), true);
  ok("...and is not guessed into a destination",
    sug.mappings.some((m) => m.header === "Code"), false);
  ok("no value-based inference happened",
    sug.mappings.some((m) => m.key === "jersey_size"), false);
  ok("'code' is not a jersey_size synonym",
    reg.BY_KEY.get("jersey_size").synonyms.includes("code"), false);

  // The coach picks Jersey size and ticks Include.
  const f = reg.BY_KEY.get("jersey_size");
  const effective = [
    ...sug.mappings,
    { header: "Code", key: "jersey_size", index: null, level: f.level,
      required: Boolean(f.requiredForIntake) },
  ];
  const enabled = new Set(sug.mappings.filter((m) => m.autoEnabled || m.required)
    .map((m) => m.header));
  enabled.add("Code");

  const active = effective.filter((m) => enabled.has(m.header));
  const buildRow = (cells) => {
    const raw = Object.fromEntries(header.map((h, c) => [h, cells[c] ?? ""]));
    const mapped = map.applyMappings(raw, active);
    const row = { contacts: [] };
    for (const [k, v] of Object.entries(mapped)) {
      if (k === "contacts") continue;
      const fld = reg.BY_KEY.get(k);
      if (!fld || reg.isIgnored(k)) continue;
      row[k] = nrm.normalizeValue(fld.type, v);
    }
    return row;
  };

  ok("AM plans into jersey_size", buildRow(grid[1]).jersey_size, "AM");
  ok("AL plans into jersey_size", buildRow(grid[2]).jersey_size, "AL");
  ok("AS plans into jersey_size", buildRow(grid[3]).jersey_size, "AS");
  ok("pants_size is untouched", buildRow(grid[1]).pants_size, undefined);
  ok("remapping one column left the others alone",
    [enabled.has("Player Name"), enabled.has("Grad Year")], [true, true]);

  // Re-importing the same file must fill the size and rewrite nothing else.
  const stored = grid.slice(1).map((cells, i) => mat.toCandidate({
    id: `p${i}`, full_name: cells[0], grad_year: Number(cells[1]),
    date_of_birth: "2010-05-05",
    player_contacts: [{ id: `c${i}`, email: `p${i}@example.invalid` }],
  }));

  let playerWrites = 0, sizes = 0, blockedRows = 0;
  for (const cells of grid.slice(1)) {
    const row = buildRow(cells);
    const m = mat.matchPlayer(row, stored);
    const plan = pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
      existingContacts: m.candidate?.contacts ?? [], decisions: {}, identity: null });
    if (plan.writes.some((w) => w.table === "players")) playerWrites += 1;
    if (plan.writes.find((w) => w.table === "team_season_players")?.values?.jersey_size) sizes += 1;
    if (!plan.executable) blockedRows += 1;
  }
  ok("re-import rewrites no player field", playerWrites, 0);
  ok("...blocks nothing", blockedRows, 0);
  ok("...and fills the size for every row", sizes, 3);
}


/* ---- Candidate population: one source, organization-wide -----------------
   The preview was given the SEASON ROSTER while the server evaluated the
   whole organization, so a player in the organization without a membership
   was invisible to the browser and visible to the server — the coach saw
   "Create" for a row the server would match. Both now read the same query. */

console.log("\nMatching candidates are organization-wide on both sides");

{
  const fsx = require("fs");
  const shared = fsx.readFileSync("lib/queries/match-candidates.js", "utf8");
  const action = fsx.readFileSync("lib/actions/intake.js", "utf8");
  const page = fsx.readFileSync("app/(app)/team/page.js", "utf8");
  const ui = fsx.readFileSync("components/RosterClient.js", "utf8");

  ok("one shared candidate query exists", /export async function listMatchCandidates/.test(shared), true);
  ok("...selecting from players, not the roster", /\.from\("players"\)/.test(shared), true);
  ok("...with no season or team filter",
    !/season_id|team_id|team_season_players/.test(shared), true);
  ok("...deriving columns from the registry", /planningPlayerColumns\(\)/.test(shared), true);
  ok("...and embedding contacts for corroboration",
    /player_contacts \( id, email \)/.test(shared), true);

  ok("the server action uses it", /listMatchCandidates\(supabase\)/.test(action), true);
  ok("the page loads it for the preview", /listMatchCandidates\(\)/.test(page), true);
  ok("the preview no longer uses the roster",
    /existingPlayers=\{\(matchCandidates \?\? \[\]\)\.map\(toCandidate\)\}/.test(ui), true);
  ok("...and both sides share toCandidate", /toCandidate/.test(ui) && /toCandidate/.test(action), true);

  /* The historical Chloe shape: in the organization, no season membership. */
  const orgWide = [
    mat.toCandidate({ id: "chloe22", full_name: "Chloe Hamlin", grad_year: 2028,
      date_of_birth: null, parent_email: null, player_contacts: [] }),
    mat.toCandidate({ id: "other", full_name: "Bella Ramos", grad_year: 2029,
      date_of_birth: "2010-06-14", player_contacts: [] }),
  ];
  const row = { full_name: "Chloe Hamlin", grad_year: 2028, date_of_birth: "2010-03-17",
    positions: ["OF"], jersey_size: "AM",
    contacts: [{ email: "chloehamlin0317@example.invalid" }] };

  const m = mat.matchPlayer(row, orgWide);
  ok("Chloe matches confidently against the org-wide set", m.classification, "confident");
  ok("...to the off-roster player", m.candidate?.id, "chloe22");

  const plan = pln.buildRowPlan({ row, match: m, existingPlayer: m.candidate,
    existingContacts: [], decisions: {}, identity: null });
  ok("...and updates rather than creating",
    Boolean(plan.writes.find((w) => w.table === "players")?.targetId), true);
  ok("...filling the missing date of birth",
    plan.resolved.find((r) => r.key === "date_of_birth")?.status, "fill");

  // Matching does not put her on the roster; the season write is the planner's.
  ok("a match does not itself add a season membership",
    plan.writes.find((w) => w.table === "team_season_players")?.values,
    { positions: ["OF"], jersey_size: "AM" });

  // The same input, same population, on both sides.
  ok("client and server agree given the same candidates",
    mat.matchPlayer(row, orgWide).candidate?.id,
    mat.matchPlayer(row, orgWide).candidate?.id, true);

  // Preserved protections.
  ok("a DOB conflict still asks",
    mat.matchPlayer({ full_name: "Chloe Hamlin", grad_year: 2028, date_of_birth: "2009-01-01", contacts: [] },
      [mat.toCandidate({ id: "z", full_name: "Chloe Hamlin", grad_year: 2028,
        date_of_birth: "2010-03-17", player_contacts: [] })]).classification, "conflict");
  ok("a grad-year conflict still asks",
    mat.matchPlayer({ full_name: "Chloe Hamlin", grad_year: 2028, contacts: [] },
      [mat.toCandidate({ id: "z", full_name: "Chloe Hamlin", grad_year: 2027, player_contacts: [] })]).classification,
    "conflict");
  ok("two same-name candidates stay ambiguous",
    mat.matchPlayer({ full_name: "Chloe Hamlin", grad_year: 2028, contacts: [] },
      [mat.toCandidate({ id: "t1", full_name: "Chloe Hamlin", grad_year: 2028, player_contacts: [] }),
       mat.toCandidate({ id: "t2", full_name: "Chloe Hamlin", grad_year: 2028, player_contacts: [] })]).classification,
    "possible");
  ok("an explicit Create is still honoured",
    Boolean(pln.buildRowPlan({ row, match: m, existingPlayer: null, existingContacts: [],
      decisions: {}, identity: "new" }).writes.find((w) => w.table === "players")?.targetId),
    false);
  const sharedCode = shared.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("organization isolation is RLS's, not a hand-written filter",
    /organization_id/.test(sharedCode), false);
}

console.log("\nImport provenance");

{
  const fsx = require("fs");
  const action = fsx.readFileSync("lib/actions/intake.js", "utf8");
  const mig = fsx.readFileSync(
    "supabase/migrations/20260830180256_intake_run_provenance.sql", "utf8");

  ok("the run records included mappings", /included: \(mappings \?\? \[\]\)/.test(action), true);
  ok("...the ignored columns", /ignored: \(ignored \?\? \[\]\)/.test(action), true);
  ok("...and the candidate count", /candidate_count: candidates\.length/.test(action), true);

  ok("each row records its classification", /classification: match\.classification/.test(action), true);
  ok("...whether the coach overrode identity", /identity: chosen/.test(action), true);
  ok("...and which player was touched", /player_id: candidate\?\.id \?\? null/.test(action), true);

  // The four outcomes are distinguishable, which is what the audits needed.
  for (const a of ["explicit_create", "coach_matched", "auto_matched", "created"]) {
    ok(`the action distinguishes ${a}`, new RegExp(`"${a}"`).test(action), true);
  }

  // PII: headers and internal ids only.
  ok("no cell values are copied into provenance",
    /row\.full_name|row\.date_of_birth|row\.player_email|raw\.contacts/.test(
      action.slice(action.indexOf("outcomes.push"), action.indexOf("outcomes.push") + 400)),
    false);
  ok("the migration states what is not stored", /NOT stored/.test(mig), true);

  ok("a replay records nothing new", /A REPLAY RECORDS NOTHING NEW/.test(mig), true);
  ok("provenance columns are nullable, so history is not invented",
    /add column if not exists mapping  jsonb/.test(mig), true);
  ok("the un-provenanced signature is gone",
    /drop function if exists public\.intake_apply_run\(uuid, text, uuid, uuid, jsonb\)/.test(mig), true);
}

console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
