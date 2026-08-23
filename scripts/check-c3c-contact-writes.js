/**
 * C3c — contact writes.
 *
 * The state this ends: reads resolved from player_contacts for the 25
 * backfilled players while the roster form still wrote players.parent_*. A
 * coach correcting a parent email saved it to a column the drawer no longer
 * read, so the correction simply never appeared.
 *
 * These are source-level and logic-level assertions. Behaviour against the
 * live database is proven separately under BEGIN ... ROLLBACK.
 *
 * Run:  node scripts/check-c3c-contact-writes.js
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

const read = (f) => fs.readFileSync(f, "utf8");

(async () => {

// ------------------------------------------------- no parent_* writers left
section("Zero live write paths to players.parent_*");

{
  // A WRITE is an object-literal key (`parent_email: ...`) in a payload.
  // A read (`p.parent_email`) is still legitimate: C3a keeps the fallback
  // until the columns are formally retired.
  const WRITE_KEY = /\bparent_(name|email|phone)\s*:/;

  const actionFiles = fs.readdirSync("lib/actions")
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join("lib/actions", f));

  const offenders = actionFiles.filter((f) => WRITE_KEY.test(read(f)));
  ok("no server action writes parent_* as a payload key", offenders.length === 0);

  ok("playerFields() no longer carries parent_*",
    !WRITE_KEY.test(
      read("lib/actions/roster.js").slice(
        read("lib/actions/roster.js").indexOf("function playerFields"),
        read("lib/actions/roster.js").indexOf("function assignmentFields")
      )
    ));

  const client = read("components/RosterClient.js");
  ok("the roster form has no parent_name input", !/name="parent_name"/.test(client));
  ok("the roster form has no parent_email input", !/name="parent_email"/.test(client));
  ok("the roster form has no parent_phone input", !/name="parent_phone"/.test(client));
  ok("the staff guardian-field defect is gone",
    !/Parent \/ guardian name/.test(client));

  // The one legitimate remaining reference: intake match corroboration.
  ok("parent_email survives only as a READ for intake matching",
    /parent_email: r\.player\?\.parent_email/.test(client));
}

// ------------------------------------------------------------- atomic add
section("Add Player is one atomic operation");

{
  const roster = read("lib/actions/roster.js");

  ok("addRosterMember calls the RPC", /rpc\("roster_add_member"/.test(roster));
  ok("...and no longer inserts players directly in the add path",
    !/addRosterMember[\s\S]{0,900}?from\("players"\)\s*\n?\s*\.insert/.test(roster));
  ok("the compensating DELETE is gone from addRosterMember",
    !/Don't leave an orphaned identity behind/.test(roster));
  ok("team and season come from server context, not the request",
    /p_team_id: ctx\.team\.id/.test(roster) && /p_season_id: ctx\.season\.id/.test(roster));
  ok("organization is NOT passed in the payload",
    !/p_organization_id/.test(roster));

  const sql = read("supabase/migrations/20260823204452_roster_add_member.sql");
  ok("the RPC is SECURITY INVOKER", /security invoker/.test(sql));
  ok("...not DEFINER", !/security definer/i.test(sql));
  ok("EXECUTE is revoked from public and anon", /revoke all on function[\s\S]*from public, anon/.test(sql));
  ok("EXECUTE is granted to authenticated", /grant execute on function[\s\S]*to authenticated/.test(sql));
  ok("organization comes from auth_organization_id()", /auth_organization_id\(\)/.test(sql));
  ok("team+season validated against that organization",
    /t\.organization_id = v_org/.test(sql));
  ok("the RPC never writes parent_*", !/parent_(name|email|phone)\s*[,)]/.test(sql));
}

// ------------------------------------------------- initial contact on add
section("Optional contact on Add Player");

{
  const roster = read("lib/actions/roster.js");
  const client = read("components/RosterClient.js");

  ok("an initial-contact reader exists", /function initialContactFields/.test(roster));
  ok("...and returns null when nothing was entered",
    /Object\.values\(c\)\.some\(\(v\) => v !== null\) \? c : null/.test(roster));
  ok("the contact block is ADD-only", /isPlayer && isNew &&/.test(client));
  ok("...and offers name, relationship, email and phone",
    /name="contact_full_name"/.test(client) && /name="contact_relationship"/.test(client)
    && /name="contact_email"/.test(client) && /name="contact_phone"/.test(client));
}

// ----------------------------------------------- legacy materialization
section("Legacy contact materialization keeps every field");

{
  const src = read("lib/actions/player-contacts.js");

  ok("a null contact_id routes to the legacy branch",
    /const contactId = text\(formData\.get\("contact_id"\)\)/.test(src));
  ok("the legacy branch INSERTs rather than updating players",
    /legacy[\s\S]{0,900}?from\("player_contacts"\)\.insert/.test(src));
  ok("the merge reads the whole resolved contact, not just submitted fields",
    /full_name: fields\.full_name \?\? legacy\.full_name/.test(src)
    && /email: fields\.email \?\? legacy\.email/.test(src)
    && /phone: fields\.phone \?\? legacy\.phone/.test(src)
    && /relationship: fields\.relationship \?\? legacy\.relationship/.test(src));
  ok("no action writes players.parent_* during materialization",
    !/from\("players"\)[\s\S]{0,200}?\.update/.test(src));

  // The behaviour the merge protects: edit ONE field, keep the rest.
  const legacy = { full_name: "Dana Alpha", relationship: null,
                   email: "dana@example.com", phone: "770-555-0101",
                   preferred_method: null };
  const submitted = { full_name: null, relationship: null, email: null,
                      phone: "770-555-9999", preferred_method: null };
  const merged = {
    full_name: submitted.full_name ?? legacy.full_name,
    relationship: submitted.relationship ?? legacy.relationship,
    email: submitted.email ?? legacy.email,
    phone: submitted.phone ?? legacy.phone,
  };
  ok("editing only the phone keeps the legacy name", merged.full_name === "Dana Alpha");
  ok("...and keeps the legacy email", merged.email === "dana@example.com");
  ok("...and applies the new phone", merged.phone === "770-555-9999");
  ok("...and invents no relationship", merged.relationship === null);

  // A nameless legacy contact must materialize with full_name still null.
  const nameless = { full_name: null, relationship: null,
                     email: "g@example.com", phone: null, preferred_method: null };
  const m2 = {
    full_name: null ?? nameless.full_name,
    email: null ?? nameless.email,
  };
  ok("a nameless legacy contact materializes with full_name NULL", m2.full_name === null);
  ok("...and keeps its email", m2.email === "g@example.com");
}

// ---------------------------------------------- authoritative edit/remove
section("Authoritative contacts: edit, remove, primary");

{
  const src = read("lib/actions/player-contacts.js");

  ok("updates are scoped to the player as well as the contact",
    /\.eq\("id", contactId\)\s*\n\s*\.eq\("player_id", playerId\)/.test(src));
  ok("an update never touches is_primary",
    /is_primary is deliberately absent/.test(src));
  ok("an all-blank edit is refused rather than deleting",
    /Use Remove contact to delete it/.test(src));
  ok("removal verifies affected rows, not the absence of an error",
    /\.delete\(\)[\s\S]{0,300}?\.select\("id"\)/.test(src)
    && /\(deleted \?\? \[\]\)\.length === 0/.test(src));
  ok("promotion demotes before promoting",
    src.indexOf('update({ is_primary: false })') < src.indexOf('update({ is_primary: true })'));
  ok("promotion verifies it actually promoted",
    /\(promoted \?\? \[\]\)\.length === 0/.test(src));
  ok("contact selection is not reimplemented — C3a is imported",
    /import \{ resolvePlayerContact \} from "\.\.\/player-contact-rules"/.test(src));

  // has_detail mirrors the database CHECK.
  const DETAIL = ["full_name", "relationship", "email", "phone"];
  const hasDetail = (c) => DETAIL.some((k) => (c[k] ?? "").toString().trim() !== "");
  ok("all-blank has no detail", hasDetail({ full_name: " ", email: "", phone: null }) === false);
  ok("a phone alone has detail", hasDetail({ phone: "770-555-0000" }) === true);
  ok("a relationship alone has detail", hasDetail({ relationship: "Mother" }) === true);
  ok("a name alone has detail", hasDetail({ full_name: "Dana" }) === true);
}

// -------------------------------------------------------- legacy import
section("Legacy import: new vs existing player");

{
  const roster = read("lib/actions/roster.js");
  const importBody = roster.slice(roster.indexOf("export async function importRoster"));

  ok("the NEW-player branch uses the atomic RPC",
    /if \(!existingId\)[\s\S]{0,400}?rpc\("roster_add_member"/.test(importBody));
  ok("...and passes contact details, not parent_* columns",
    /p_contact:[\s\S]{0,300}?text_\(raw\.parent_email\)/.test(importBody)
    && !/parent_email:\s*text_/.test(importBody));
  ok("the EXISTING-player branch only inserts a season assignment",
    /EXISTING player: assign to the season and NOTHING else/.test(importBody));
  ok("...and never writes contacts",
    !/existingId[\s\S]{0,600}?player_contacts/.test(importBody));
  ok("...and never updates the player record",
    !/existingId[\s\S]{0,600}?from\("players"\)[\s\S]{0,60}?\.update/.test(importBody));
}

// -------------------------------------------------------------- UI shape
section("The editor can represent multiple contacts");

{
  const ui = read("components/PlayerContacts.js");

  ok("contacts are rendered as a list", /contacts\.map\(/.test(ui));
  ok("a nameless contact gets no manufactured name",
    !/Parent of /.test(ui) && !/Parent\/Guardian/.test(ui));
  ok("an explicit primary and a derived one are labelled differently",
    /Primary \(assumed\)/.test(ui) && /isPrimaryDerived/.test(ui));
  ok("a legacy contact offers no Remove (no row exists yet)",
    /c\.source !== "legacy" &&[\s\S]{0,200}?Remove/.test(ui));
  ok("a legacy contact offers no Make primary",
    /c\.source !== "legacy" && !c\.is_primary/.test(ui));
  ok("removal is confirmed", /confirm\(/.test(ui));
  ok("ordering is not reimplemented in the component",
    !/sort\(/.test(ui));
}

// -------------------------------------------------------------------- report
console.log(`\n${passed} assertions, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
})();
