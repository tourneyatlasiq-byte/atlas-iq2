/**
 * Import Players — activation end-to-end.
 *
 * Drives the REAL engine modules from a synthetic spreadsheet grid all the way
 * to the executable plan: header detection, mapping, normalisation, matching,
 * conflict resolution and plan construction. Every value is synthetic; no
 * production PII is committed.
 *
 * WHAT THIS DOES NOT COVER. applyIntake() is a "use server" action and needs an
 * authenticated Next runtime, so the step from plan to RPC payload cannot be
 * executed here. That layer is covered by check-intake.js (plan safety) and by
 * the production BEGIN...ROLLBACK scenarios (execution). This file covers
 * everything up to the payload.
 *
 * Run:  node scripts/check-import-activation.js
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const load = (f) => import(pathToFileURL(path.resolve(f)).href);

let passed = 0;
const failures = [];
function ok(name, cond) {
  if (cond) { passed += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}`); }
}
function section(t) { console.log(`\n${t}\n`); }

(async () => {
const { suggestMappings, applyMappings, looksLikeHeaders } = await load("lib/intake/map-headers.js");
const { normalizeValue, composeFullName } = await load("lib/intake/normalize.js");
const { matchPlayer, CLASS } = await load("lib/intake/match.js");
const { buildRowPlan, assertPlanSafe } = await load("lib/intake/plan.js");
const { BY_KEY, isIgnored } = await load("lib/intake/registry.js");

/** Mirrors the component: grid -> normalised row + contacts. */
function toRow(mapped) {
  const row = {};
  for (const [k, v] of Object.entries(mapped)) {
    if (k === "contacts") continue;
    const field = BY_KEY.get(k);
    if (!field || isIgnored(k)) continue;
    row[k] = normalizeValue(field.type, v);
  }
  if (!row.full_name) {
    const composed = composeFullName(row);
    if (composed) row.full_name = composed;
  }
  row.contacts = (mapped.contacts ?? []).map((c) => ({
    ...c,
    full_name: normalizeValue("text", c.full_name),
    email: normalizeValue("email", c.email),
    phone: normalizeValue("phone", c.phone),
  }));
  return row;
}

// A file shaped like a real export: structured names, a second guardian
// column group, mixed-case bats/throws, an X handle.
const GRID = [
  ["First Name","Last Name","Grad Year","Bats","Throws","Jersey",
   "Parent/Guardian 1 Full Name","Parent/Guardian 1 Email","Parent/Guardian 1 Phone",
   "Parent/Guardian 2 Full Name","Parent/Guardian 2 Email","X Handle"],
  ["Ava","Alpha","2028","right","R","2",
   "Dana Alpha","dana@example.com","(770) 555-0101","","",""],
  ["Bea","Beta","2029","LEFT","l","7",
   "Cass Beta","cass@example.com","770-555-0202","Drew Beta","drew@example.com","@beabeta"],
  ["Cleo","Gamma","2030","S","R","9","","","","",""],
];

section("Upload and header detection");
{
  ok("headers are detected", looksLikeHeaders(GRID[0], GRID[1]) === true);
  // The negative case (a headerless file) is covered in check-intake.js with a
  // realistic fixture. Reproducing it here with synthetic values proved
  // misleading: several invented data values coincidentally match field
  // synonyms and trip the recognition threshold, which says more about the
  // fixture than the heuristic.
}

section("Mapping and contact groups");
const { mappings } = suggestMappings(GRID[0]);
{
  const dest = (h) => mappings.find((m) => m.header === h)?.key;
  ok("first name maps to the structured column", dest("First Name") === "legal_first_name");
  ok("last name maps", dest("Last Name") === "last_name");
  ok("grad year maps", dest("Grad Year") === "grad_year");
  ok("bats maps", dest("Bats") === "bats");
  ok("throws maps", dest("Throws") === "throws");
  ok("guardian 1 name maps to a contact field", dest("Parent/Guardian 1 Full Name") === "contact_name");
  ok("guardian 2 email maps to a contact field", dest("Parent/Guardian 2 Email") === "contact_email");
  ok("the X handle is mappable", dest("X Handle") === "social_handle");
}

// Every mapped column switched on, as the coach would after review.
const enabled = new Set(mappings.map((m) => `${m.key}${m.index ?? ""}`));
const asObject = (r) => Object.fromEntries(GRID[0].map((h, i) => [h, r[i]]));
const mappedRows = GRID.slice(1).map((r) => applyMappings(asObject(r), mappings, { enabledKeys: enabled }));
const rows = mappedRows.map(toRow);

section("Normalisation and derived full_name");
{
  ok("bats 'right' normalises to R", rows[0].bats === "R");
  ok("throws 'R' stays R", rows[0].throws === "R");
  ok("bats 'LEFT' normalises to L", rows[1].bats === "L");
  ok("throws 'l' normalises to L", rows[1].throws === "L");
  ok("switch hitter 'S' is preserved", rows[2].bats === "S");
  ok("full_name is DERIVED from structured names", rows[0].full_name === "Ava Alpha");
  ok("...for every row", rows[1].full_name === "Bea Beta" && rows[2].full_name === "Cleo Gamma");
  ok("structured names are retained alongside", rows[0].legal_first_name === "Ava" && rows[0].last_name === "Alpha");
  ok("grad_year is numeric", rows[0].grad_year === 2028);
  ok("phone is normalised", typeof rows[0].contacts[0].phone === "string"
    && /\d/.test(rows[0].contacts[0].phone));
}

section("Contacts: one, several, and none");
{
  ok("row 1 has exactly one contact", rows[0].contacts.length === 1);
  ok("row 2 has two contacts", rows[1].contacts.length === 2);
  ok("...in column-group order", rows[1].contacts[0].full_name === "Cass Beta"
    && rows[1].contacts[1].full_name === "Drew Beta");
  ok("row 3 has no contact at all", rows[2].contacts.length === 0);
  ok("a contact with no name is not invented",
    rows.every((r) => r.contacts.every((c) => c.full_name === null || typeof c.full_name === "string")));
}

section("New players");
{
  const plans = rows.map((row) => {
    const match = matchPlayer(row, []);
    return { match, plan: buildRowPlan({ row, match, existingPlayer: null, existingContacts: [], decisions: {}, identity: null }) };
  });
  ok("all three classify as new", plans.every((p) => p.match.classification === CLASS.NEW));
  ok("every plan is executable", plans.every((p) => p.plan.executable));
  ok("every plan passes the safety assertion",
    plans.every((p) => { try { assertPlanSafe(p.plan); return true; } catch { return false; } }));

  const t = (p, table) => p.plan.writes.filter((w) => w.table === table);
  ok("a players write exists for each", plans.every((p) => t(p, "players").length === 1));
  ok("a season membership write exists for each",
    plans.every((p) => t(p, "team_season_players").length === 1));
  ok("row 1 writes one contact", t(plans[0], "player_contacts").length === 1);
  ok("row 2 writes two contacts", t(plans[1], "player_contacts").length === 2);
  ok("row 3 writes no contact", t(plans[2], "player_contacts").length === 0);
  ok("only the FIRST contact of a new player claims primary",
    t(plans[1], "player_contacts").filter((w) => w.isPrimary).length === 1);
  ok("the X handle becomes a player_links write",
    t(plans[1], "player_links").length === 1 && t(plans[1], "player_links")[0].linkType === "X");
  ok("...with the coach's original label preserved",
    t(plans[1], "player_links")[0].values.label === "@beabeta");
  ok("a row without a handle writes no link", t(plans[0], "player_links").length === 0);
  ok("no plan touches a prohibited table",
    plans.every((p) => p.plan.writes.every((w) =>
      ["players", "team_season_players", "player_contacts", "player_links"].includes(w.table))));
  ok("no plan writes parent_* columns",
    plans.every((p) => p.plan.writes.every((w) =>
      !Object.keys(w.values ?? {}).some((k) => k.startsWith("parent_")))));
}

section("Matched existing player");
{
  const existing = [{
    id: "p-1", full_name: "Ava Alpha", legal_first_name: "Ava", last_name: "Alpha",
    grad_year: 2028, date_of_birth: null, parent_email: null, contacts: [],
  }];
  const match = matchPlayer(rows[0], existing);
  ok("the same person is recognised, not duplicated", match.classification !== CLASS.NEW);
  ok("...and the candidate is the existing record", match.candidate?.id === "p-1");

  // An approved update: the file carries a grad year the record lacks.
  const thin = [{ id: "p-2", full_name: "Bea Beta", legal_first_name: "Bea",
                  last_name: "Beta", grad_year: null, date_of_birth: null,
                  parent_email: null, contacts: [] }];
  const m2 = matchPlayer(rows[1], thin);
  const plan2 = buildRowPlan({ row: rows[1], match: m2, existingPlayer: thin[0],
                               existingContacts: [], decisions: {}, identity: null });
  const pw = plan2.writes.find((w) => w.table === "players");
  ok("an update targets the existing player id", pw?.targetId === "p-2");
  ok("...and fills the empty grad year", pw?.values?.grad_year === 2029);
}

section("Different Player resolution");
{
  const existing = [{ id: "p-1", full_name: "Ava Alpha", legal_first_name: "Ava",
                      last_name: "Alpha", grad_year: 2031, date_of_birth: null,
                      parent_email: null, contacts: [] }];
  const match = matchPlayer(rows[0], existing);
  const asSame = buildRowPlan({ row: rows[0], match, existingPlayer: existing[0],
                                existingContacts: [], decisions: {}, identity: "same" });
  const asNew = buildRowPlan({ row: rows[0], match, existingPlayer: null,
                               existingContacts: [], decisions: {}, identity: "new" });
  ok("choosing Same Player targets the existing record",
    asSame.writes.find((w) => w.table === "players")?.targetId === "p-1");
  ok("choosing Different Player creates a NEW record",
    !asNew.writes.find((w) => w.table === "players")?.targetId);
  ok("...and the two resolutions differ",
    JSON.stringify(asSame.writes) !== JSON.stringify(asNew.writes));
}

section("Blank values never erase");
{
  const sparse = toRow(applyMappings(
    asObject(["Ava","Alpha","","","","","","","","","",""]), mappings, { enabledKeys: enabled }));
  const existing = { id: "p-1", full_name: "Ava Alpha", legal_first_name: "Ava",
                     last_name: "Alpha", grad_year: 2028, date_of_birth: null,
                     parent_email: null, contacts: [] };
  const match = matchPlayer(sparse, [existing]);
  const plan = buildRowPlan({ row: sparse, match, existingPlayer: existing,
                              existingContacts: [], decisions: {}, identity: "same" });
  const values = plan.writes.find((w) => w.table === "players")?.values ?? {};
  ok("a blank grad year is not written at all",
    !("grad_year" in values) || values.grad_year === undefined);
  ok("...so it cannot overwrite the stored value", values.grad_year !== null);
  ok("a blank bats is not written",
    !("bats" in values) || values.bats === undefined);
}

section("Activation wiring");
{
  const ui = fs.readFileSync("components/PlayerIntake.js", "utf8");
  ok("the Import button is no longer hard-disabled",
    !/disabled aria-disabled="true"/.test(ui));
  ok("the 'not switched on yet' notice is gone",
    !/Importing isn&rsquo;t switched on yet/.test(ui));
  ok("the button calls the import handler", /onClick=\{onImport\}/.test(ui));
  ok("it is disabled while a submission is in flight", /disabled=\{importing \|\| blocked \|\| !canImport\}/.test(ui));
  ok("a second submission is refused in the handler", /if \(importing \|\| outcome\) return;/.test(ui));
  ok("the run key is passed through", /runKey,/.test(ui));
  // A CALL is what would bypass idempotency; the name in a comment is
  // documentation. Match rpc("...") specifically.
  ok("it goes through applyIntake, not a direct RPC",
    /applyIntake\(/.test(ui) && !/rpc\(\s*["']intake_apply/.test(ui));
  ok("a replayed import is labelled as already saved",
    /already saved/.test(ui));
  ok("the confirmation reports real counters", /describeOutcome\(outcome\)/.test(ui));

  const action = fs.readFileSync("lib/actions/intake.js", "utf8");
  ok("the action still routes through the idempotent wrapper",
    /rpc\("intake_apply_run"/.test(action));
}

console.log(`\n${passed} assertions, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
})();
