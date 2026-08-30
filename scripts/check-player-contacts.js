/**
 * Player contact resolution — C3a.
 *
 * Two things are being guarded. First, that `player_contacts` genuinely wins
 * over the legacy `parent_*` columns at ROW level, because a per-field merge
 * would resurrect a stale number next to a corrected one. Second, that roster
 * and readiness cannot drift apart again: they previously held two different
 * definitions of "has contact information" and no production row happened to
 * expose the difference.
 *
 * The equivalence block replays the SIX distinct field-presence shapes that
 * exist in production today, counted from the live database. Only the NULL
 * pattern is reproduced — every value here is synthetic, so no player or
 * guardian PII is committed.
 *
 * Run:  node scripts/check-player-contacts.js
 */
const { pathToFileURL } = require("url");
const path = require("path");

const load = (f) => import(pathToFileURL(path.resolve(f)).href);

let passed = 0;
const failures = [];

function ok(name, cond) {
  if (cond) { passed += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}`); }
}
function section(t) { console.log(`\n${t}\n`); }

const contact = (o = {}) => ({
  id: o.id ?? "c-1", full_name: o.full_name ?? null, relationship: o.relationship ?? null,
  email: o.email ?? null, phone: o.phone ?? null, preferred_method: o.preferred_method ?? null,
  is_primary: o.is_primary ?? false, sort_order: o.sort_order ?? 0,
  created_at: o.created_at ?? "2026-01-01T00:00:00Z",
});

(async () => {
const { resolvePlayerContact, isReachable } = await load("lib/player-contact-rules.js");

// ---------------------------------------------------------------- precedence
section("Source precedence is row-level");

{
  const p = {
    parent_name: "Legacy Name", parent_email: "legacy@example.com", parent_phone: "770-555-0000",
    player_contacts: [contact({ id: "c-a", full_name: "New Name", email: "new@example.com" })],
  };
  const r = resolvePlayerContact(p);
  ok("player_contacts wins when a row exists", r.source === "player_contacts");
  ok("exactly one contact is resolved", r.contacts.length === 1);
  ok("the legacy name does not appear", r.contacts[0].full_name === "New Name");
  ok("the legacy email does not appear", r.contacts[0].email === "new@example.com");
  // The trap: the contact row has no phone, the legacy column does.
  ok("legacy phone is NOT merged into the gap", r.contacts[0].phone === null);
  ok("no resolved contact carries the legacy source", r.contacts.every((c) => c.source === "player_contacts"));
}

{
  const p = { parent_name: null, parent_email: "legacy@example.com", parent_phone: null, player_contacts: [] };
  const r = resolvePlayerContact(p);
  ok("empty contacts array falls back to legacy", r.source === "legacy");
  ok("...producing at most one contact", r.contacts.length === 1);
  ok("...with the legacy source marked", r.contacts[0].source === "legacy");
  ok("...and a null id, since no row exists", r.contacts[0].id === null);
}

{
  const r = resolvePlayerContact({ parent_email: "legacy@example.com" });
  ok("a missing player_contacts key degrades to legacy, not a throw", r.source === "legacy");
}

{
  const r = resolvePlayerContact({ parent_name: null, parent_email: null, parent_phone: null, player_contacts: [] });
  ok("all sources empty resolves to none", r.source === "none");
  ok("...with no contacts", r.contacts.length === 0);
  ok("...and a null primary", r.primary === null);
  ok("...and is not reachable", r.reachable === false);
  ok("...and has no detail", r.hasAnyDetail === false);
}

{
  const r = resolvePlayerContact({ parent_name: "   ", parent_email: "  ", parent_phone: null, player_contacts: [] });
  ok("whitespace-only legacy columns are absent, not present", r.source === "none");
}

{
  const p = {
    parent_email: "legacy@example.com",
    player_contacts: [contact({ id: "c-a", email: "a@example.com" }), contact({ id: "c-b", email: "b@example.com", sort_order: 1 })],
  };
  ok("two rows still fully suppress legacy", resolvePlayerContact(p).contacts.length === 2);
}

// ------------------------------------------------------------------- primary
section("Primary selection is deterministic");

{
  const p = { player_contacts: [
    contact({ id: "c-a", sort_order: 0 }),
    contact({ id: "c-b", sort_order: 1, is_primary: true }),
  ] };
  const r = resolvePlayerContact(p);
  ok("an explicit primary is chosen over sort_order", r.primary.id === "c-b");
  ok("...and is not marked derived", r.primary.isPrimaryDerived === false);
  ok("...and is ordered first", r.contacts[0].id === "c-b");
}

{
  const p = { player_contacts: [
    contact({ id: "c-b", sort_order: 5 }),
    contact({ id: "c-a", sort_order: 1 }),
  ] };
  const r = resolvePlayerContact(p);
  ok("with no primary, lowest sort_order wins", r.primary.id === "c-a");
  ok("...and is flagged as derived", r.primary.isPrimaryDerived === true);
  ok("...while is_primary itself stays false (nothing is promoted)", r.primary.is_primary === false);
}

{
  const p = { player_contacts: [
    contact({ id: "c-b", sort_order: 0, created_at: "2026-02-01T00:00:00Z" }),
    contact({ id: "c-a", sort_order: 0, created_at: "2026-01-01T00:00:00Z" }),
  ] };
  ok("sort_order ties break on created_at", resolvePlayerContact(p).primary.id === "c-a");
}

{
  const p = { player_contacts: [
    contact({ id: "zzz", sort_order: 0, created_at: "2026-01-01T00:00:00Z" }),
    contact({ id: "aaa", sort_order: 0, created_at: "2026-01-01T00:00:00Z" }),
  ] };
  ok("created_at ties break on id", resolvePlayerContact(p).primary.id === "aaa");
}

{
  // Shuffled input must never change the answer. A derived primary that moved
  // between renders would be worse than none.
  const rows = [
    contact({ id: "c-c", sort_order: 2 }),
    contact({ id: "c-a", sort_order: 0 }),
    contact({ id: "c-b", sort_order: 1 }),
    contact({ id: "c-d", sort_order: 3 }),
  ];
  const orders = [
    [0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1], [0, 3, 2, 1], [1, 0, 2, 3],
  ];
  const results = orders.map((o) =>
    resolvePlayerContact({ player_contacts: o.map((i) => rows[i]) }).contacts.map((c) => c.id).join(",")
  );
  ok("shuffled input yields one stable order", new Set(results).size === 1);
  ok("...and that order is c-a,c-b,c-c,c-d", results[0] === "c-a,c-b,c-c,c-d");
}

{
  const before = [contact({ id: "c-a", sort_order: 1 }), contact({ id: "c-b", sort_order: 0 })];
  const snapshot = JSON.stringify(before);
  resolvePlayerContact({ player_contacts: before });
  ok("resolving does not mutate the input rows", JSON.stringify(before) === snapshot);
}

// ------------------------------------------------------------- null full_name
section("A missing name is never manufactured");

{
  const p = { player_contacts: [contact({ id: "c-a", full_name: null, relationship: "Mother", email: "m@example.com" })] };
  const r = resolvePlayerContact(p);
  ok("full_name stays null", r.primary.full_name === null);
  ok("relationship is preserved as its own field", r.primary.relationship === "Mother");
  const blob = JSON.stringify(r);
  ok("no 'Parent/Guardian' placeholder appears", !blob.includes("Parent/Guardian"));
  ok("no 'Parent of' placeholder appears", !blob.includes("Parent of"));
  ok("no em-dash or hyphen placeholder appears", r.primary.full_name !== "—" && r.primary.full_name !== "-");
  ok("relationship is not copied into full_name", r.primary.full_name !== r.primary.relationship);
  ok("a nameless but relationship-bearing contact still has detail", r.hasAnyDetail === true);
}

{
  const p = { parent_name: null, parent_email: "g@example.com", parent_phone: null, player_contacts: [] };
  const r = resolvePlayerContact(p);
  ok("legacy fallback with no parent_name keeps full_name null", r.primary.full_name === null);
  ok("...and invents no relationship", r.primary.relationship === null);
}

// ------------------------------------------- reachable vs hasAnyDetail
section("reachable and hasAnyDetail are distinct and shared");

{
  const nameOnly = { parent_name: "Some Guardian", parent_email: null, parent_phone: null, player_contacts: [] };
  const r = resolvePlayerContact(nameOnly);
  ok("a name alone is NOT reachable", r.reachable === false);
  ok("...but does have detail worth showing", r.hasAnyDetail === true);
  ok("isReachable() agrees with the resolver", isReachable(nameOnly) === r.reachable);
}

{
  // The latent bug: player_phone counted for the roster, never for readiness.
  const phoneOnly = { player_phone: "770-555-0101", player_contacts: [] };
  ok("player_phone alone IS reachable (the fixed rule)", resolvePlayerContact(phoneOnly).reachable === true);
  const emailOnly = { player_email: "p@example.com", player_contacts: [] };
  ok("player_email alone is reachable", resolvePlayerContact(emailOnly).reachable === true);
}

{
  const viaContact = { player_contacts: [contact({ id: "c-a", phone: "770-555-0102" })] };
  ok("a contact phone makes the player reachable", resolvePlayerContact(viaContact).reachable === true);
  const viaContactEmail = { player_contacts: [contact({ id: "c-a", email: "c@example.com" })] };
  ok("a contact email makes the player reachable", resolvePlayerContact(viaContactEmail).reachable === true);
}

{
  // Every combination of the five channel/name fields, legacy path.
  const F = ["player_email", "player_phone", "parent_name", "parent_email", "parent_phone"];
  let checked = 0, consistent = 0;
  for (let m = 0; m < 32; m += 1) {
    const p = { player_contacts: [] };
    F.forEach((f, i) => { if (m & (1 << i)) p[f] = f.includes("email") ? "x@example.com" : f === "parent_name" ? "N" : "770-555-0000"; });
    const r = resolvePlayerContact(p);
    const expectedReachable = Boolean(p.player_email || p.player_phone || p.parent_email || p.parent_phone);
    const expectedDetail = Boolean(expectedReachable || p.parent_name);
    checked += 1;
    if (r.reachable === expectedReachable && r.hasAnyDetail === expectedDetail) consistent += 1;
  }
  ok(`all ${checked} field combinations resolve consistently`, consistent === 32);
  ok("reachable always implies hasAnyDetail", consistent === 32);
}

// --------------------------------------------------- production equivalence
section("Equivalence against the six production shapes");

/**
 * The exact NULL patterns counted from production, with the number of rows in
 * each of the two populations that matter:
 *   allPlayers — every players row (56)
 *   readiness  — is_active AND person_type = 'player' (50)
 */
const PRODUCTION_SHAPES = [
  // p_email p_phone g_name g_email g_phone  type      all  readiness
  [false, false, false, false, false, "coach",  2,  0],
  [true,  true,  false, false, false, "coach",  1,  0],
  [false, false, false, false, false, "player", 28, 28],
  [false, false, false, true,  false, "player", 2,  1],
  [false, false, false, true,  true,  "player", 14, 12],
  [true,  true,  true,  true,  true,  "player", 9,  9],
];

const build = ([pe, pp, gn, ge, gp, type]) => ({
  person_type: type,
  player_email: pe ? "p@example.com" : null,
  player_phone: pp ? "770-555-0001" : null,
  parent_name: gn ? "Synthetic Guardian" : null,
  parent_email: ge ? "g@example.com" : null,
  parent_phone: gp ? "770-555-0002" : null,
  player_contacts: [],           // production holds ZERO contact rows today
});

/** The rule readiness used before C3a. */
const oldReadiness = (p) => Boolean(p.parent_email || p.parent_phone || p.player_email);
/** The rule the roster drawer used before C3a. */
const oldRoster = (p) => Boolean(
  p.player_email || p.player_phone ||
  ((p.person_type ?? "player") === "player" && (p.parent_name || p.parent_email || p.parent_phone))
);

{
  let allRows = 0, readinessRows = 0;
  let readinessSame = 0, rosterSame = 0, legacyPath = 0;

  for (const shape of PRODUCTION_SHAPES) {
    const [, , , , , type, nAll, nReady] = shape;
    const p = build(shape);
    const r = resolvePlayerContact(p);
    allRows += nAll;
    readinessRows += nReady;

    if (r.source !== "player_contacts") legacyPath += nAll;
    if (r.reachable === oldReadiness(p)) readinessSame += nReady;

    const newRoster = Boolean(p.player_email || p.player_phone || (type === "player" && r.hasAnyDetail));
    if (newRoster === oldRoster(p)) rosterSame += nAll;
  }

  ok(`the shapes account for all 56 players rows`, allRows === 56);
  ok(`the shapes account for all 50 readiness rows`, readinessRows === 50);
  ok("every production row takes the legacy path (0 contact rows exist)", legacyPath === 56);
  ok(`readiness verdict unchanged for all ${readinessRows} readiness rows`, readinessSame === 50);
  ok(`roster contact section unchanged for all ${allRows} rows`, rosterSame === 56);
}

{
  // Why the divergence count is zero, structurally rather than by luck: no
  // production shape has a phone without an email, or a guardian name without
  // a guardian email. If one ever appears, this assertion is the warning.
  const risky = PRODUCTION_SHAPES.filter(([pe, pp, gn, ge, gp]) =>
    (pp && !pe && !ge && !gp) || (gn && !ge && !gp && !pe && !pp));
  ok("no production shape exercises the old rules' disagreement", risky.length === 0);
}

// ------------------------------------------------------------------- staff
section("Staff never resolve guardian contacts");

{
  const coach = build([true, true, false, false, false, "coach"]);
  const r = resolvePlayerContact(coach);
  ok("a coach with no guardian columns has no contacts", r.contacts.length === 0);
  ok("...but is still reachable by their own details", r.reachable === true);
}

// -------------------------------------------------------------------- report

/* ---- Deliberate clearing, and the empty-contact choice -------------------
   A coach put the player's own email on a guardian card by mistake, cleared
   the field and pressed Save. Nothing happened. The server was refusing
   correctly -- the contact held only that email, so clearing it would have
   left an empty row -- but the refusal rendered at the top of the contacts
   panel, which on a phone was off the screen. Save looked broken.

   Import's blank-no-erase rule is deliberately NOT reused for manual edits:
   an import cannot see what it would overwrite, and a coach can. */

section("Clearing a contact field");

{
  const fs = require("fs");
  const act = fs.readFileSync("lib/actions/player-contacts.js", "utf8");
  const ui  = fs.readFileSync("components/PlayerContacts.js", "utf8");
  const css = fs.readFileSync("app/globals.css", "utf8");

  ok("an emptying edit returns a code", /code: "would_be_empty"/.test(act));
  ok("...from both the normal and legacy branches",
     (act.match(/code: "would_be_empty"/g) || []).length === 2);
  ok("the empty-contact guard still exists",
     (act.match(/if \(!hasDetail\(/g) || []).length >= 2);

  // Strip comments: the fix is DESCRIBED in one, so matching raw text would
  // report the explanation as the defect.
  const actCode = act.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("legacy no longer falls back to the stored value",
     !/\?\? legacy\./.test(actCode));
  ok("...and uses the submitted state directly",
     /const merged = \{ \.\.\.fields \};/.test(act));
  ok("the normal branch keeps the same rule",
     /const next = \{ \.\.\.fields \};/.test(act));

  ok("full_name is read from the form", /full_name: text\(formData\.get/.test(act));
  ok("relationship is read from the form", /relationship: text\(formData\.get/.test(act));
  ok("email is read from the form", /email: text\(formData\.get/.test(act));
  ok("phone is read from the form", /phone: text\(formData\.get/.test(act));
  ok("blank reads as null, which is what clears",
     /return s === "" \? null : s;/.test(act));

  ok("the editor takes an error prop", /error = null, emptyOffer = false/.test(ui));
  ok("...and renders it inside the card", /className="pc-form-error"/.test(ui));
  ok("the panel alert now shows only unattached errors",
     /error && errorFor === null &&/.test(ui));
  ok("the error is routed to the form that failed", /setErrorFor\(forContact\)/.test(ui));

  ok("an emptying edit offers removal", /className="pc-empty-offer"/.test(ui));
  ok("...with the promised wording",
     /This would leave the contact empty\. Remove this contact instead\?/.test(ui));
  ok("...and the action attached", /Remove this contact/.test(ui));
  ok("removal still confirms first", /if \(!confirm\(/.test(ui));

  ok(".pc-form-error is styled", /\.pc-form-error \{/.test(css));
  ok(".pc-empty-offer is styled", /\.pc-empty-offer \{/.test(css));
}


section("Removing a contact");

{
  const fs = require("fs");
  const ui  = fs.readFileSync("components/PlayerContacts.js", "utf8");
  const act = fs.readFileSync("lib/actions/player-contacts.js", "utf8");
  const css = fs.readFileSync("app/globals.css", "utf8");
  const uiCode = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // ROOT CAUSE: window.confirm() is the one step with a silent failure mode.
  // Suppressed by the browser -> returns false -> early return -> no request,
  // no spinner, no error. Indistinguishable from a broken button.
  ok("no native confirm() gates removal", !/\bconfirm\(/.test(uiCode));
  ok("removal is confirmed in the page", /className="pc-confirm"/.test(ui));
  ok("...with an explicit confirm action", /"Remove contact"/.test(ui));
  ok("...and a way out", /\n\s*Keep\n/.test(ui));
  ok("the first tap only asks", /onClick=\{\(\) => askRemove\(c\)\}/.test(ui));
  ok("...and the second deletes", /onClick=\{\(\) => doRemove\(c\)\}/.test(ui));

  // A successful delete must leave the OPEN drawer, not just the cache.
  // The refresh now lives in the shared runner, so every caller gets it.
  const hook = fs.readFileSync("components/useMutation.js", "utf8");
  ok("contacts use the shared mutation runner", /useMutation\(\)/.test(ui));
  ok("the shared runner refreshes on success", /router\.refresh\(\)/.test(hook));
  ok("...and the server still revalidates", /revalidatePath\("\/team"\)/.test(act));

  // Progress is visible while it runs.
  ok("the confirm button shows progress", /Removing…/.test(ui));

  // Works for every guardian shape, including the ones just cleaned up.
  ok("removal is offered for any stored contact",
     /c\.source !== "legacy" && \(/.test(ui));
  ok("a primary contact is removable too — no is_primary gate on Remove",
     !/is_primary[\s\S]{0,120}?askRemove/.test(ui));
  ok("an email-only contact is removable: nothing inspects its fields",
     !/hasDetail[\s\S]{0,160}?askRemove/.test(ui));

  // The server side proven earlier stays as it was.
  ok("the delete still scopes to the player", /\.eq\("player_id", playerId\)/.test(act));
  ok("...and verifies affected rows", /\(deleted \?\? \[\]\)\.length === 0/.test(act));

  ok(".pc-confirm is styled", /\.pc-confirm \{/.test(css));
  ok("confirmation buttons meet the mobile target",
     /\.pc-confirm \.btn, \.pc-empty-offer \.btn \{ min-height: 44px; \}/.test(css));
}



section("Legacy contacts are not routed through a DELETE");

{
  const fs2 = require("fs");
  const ui2 = fs2.readFileSync("components/PlayerContacts.js", "utf8");
  const rules = fs2.readFileSync("lib/player-contact-rules.js", "utf8");

  // A legacy contact is reconstructed from parent_* and has NO row.
  ok("a legacy contact carries a null id", /id: null,/.test(rules));
  ok("...and is marked as a derived primary", /isPrimaryDerived: true/.test(rules));

  // The bug: confirmRemove === c.id was null === null, TRUE before any tap,
  // so every legacy guardian showed its confirmation and confirming sent the
  // string "null" to a uuid column.
  ok("the confirmation is keyed by a non-null slot", /confirmRemove === slotOf\(c\)/.test(ui2));
  const ui2code = ui2.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("...and never on a raw possibly-null id", !/confirmRemove === c\.id/.test(ui2code));
  ok("...and additionally requires a real id", /confirmRemove === slotOf\(c\) && c\.id/.test(ui2));

  ok("removal refuses a contact with no row", /if \(c\.source === "legacy" \|\| !c\.id\)/.test(ui2));
  ok("...explaining what to do instead", /has no record to remove/.test(ui2));
  ok("...and the request is never built", /if \(!c\.id\) return;/.test(ui2));
  ok("the Remove button stays hidden for legacy", /c\.source !== "legacy" && \(/.test(ui2));

  // Not fixed by coercion.
  ok("no string 'null' filtering was added", !/=== "null"|!== "null"/.test(ui2));

  // Real contacts, primary or not, are unaffected.
  ok("a real contact still uses its id as the slot",
     /c\.source === "legacy" \? "legacy" : c\.id/.test(ui2));
  ok("is_primary does not gate removal", !/is_primary[\s\S]{0,120}?askRemove/.test(ui2));
}


console.log(`\n${passed} assertions, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
})();
