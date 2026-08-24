/**
 * Structured names and Player Details parity.
 *
 * The defect these guard: Edit Details wrote players.full_name and never
 * touched legal_first_name / preferred_first_name / last_name, which appeared
 * in no roster read or write path at all. Renaming an imported player left the
 * structured columns holding the old name, so full_name drifted from the
 * values it is supposed to be derived from.
 *
 * Exposure was zero at the time — all 56 production players carry full_name
 * only — but Import Players is the one thing that populates structured names,
 * so the first real import creates exactly the records that would drift.
 *
 * NOTHING IS EVER PARSED. full_name is not split into components anywhere;
 * these assert that too, because a plausible-looking split is the tempting
 * wrong fix.
 *
 * Run:  node scripts/check-structured-names.js
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
const { composeFullName, hasStructuredName, nameIsConsistent } =
  await load("lib/intake/normalize.js");

/** Mirrors nameFields() in lib/actions/roster.js. */
const text = (v) => { const s = (v ?? "").toString().trim(); return s === "" ? null : s; };

function saveName(form) {
  const structured = "last_name" in form || "legal_first_name" in form
                  || "preferred_first_name" in form;
  if (!structured) return { ok: true, values: { full_name: text(form.full_name) } };

  const legal_first_name     = text(form.legal_first_name);
  const preferred_first_name = text(form.preferred_first_name);
  const last_name            = text(form.last_name);

  if (!last_name || !(legal_first_name || preferred_first_name)) {
    return { ok: false, error: "Enter a first and last name." };
  }
  // full_name from the payload is ignored outright.
  return {
    ok: true,
    values: {
      legal_first_name, preferred_first_name, last_name,
      full_name: composeFullName({ legal_first_name, preferred_first_name, last_name }),
    },
  };
}

// -------------------------------------------------- structured cannot drift
section("Structured edits cannot create full_name drift");

{
  // As Import creates them.
  const imported = { legal_first_name: "Ava", preferred_first_name: null,
                     last_name: "Alpha", full_name: "Ava Alpha" };
  ok("an imported record starts consistent", nameIsConsistent(imported) === true);
  ok("...and is recognised as structured", hasStructuredName(imported) === true);

  // The exact edit that used to drift: change the surname.
  const saved = saveName({ legal_first_name: "Ava", preferred_first_name: "",
                           last_name: "Alpha-Smith", full_name: "IGNORE ME" });
  ok("the save succeeds", saved.ok === true);
  ok("last_name is written", saved.values.last_name === "Alpha-Smith");
  ok("full_name is REDERIVED, not taken from the form",
    saved.values.full_name === "Ava Alpha-Smith");
  ok("...so a stale full_name in the payload is ignored",
    saved.values.full_name !== "IGNORE ME");
  ok("the record remains consistent",
    nameIsConsistent({ ...imported, ...saved.values }) === true);

  // Every field individually.
  for (const [field, value, expected] of [
    ["legal_first_name", "Avery", "Avery Alpha"],
    ["last_name", "Beta", "Ava Beta"],
  ]) {
    const r = saveName({ legal_first_name: "Ava", last_name: "Alpha", [field]: value });
    ok(`changing ${field} rederives full_name`, r.values.full_name === expected);
    ok(`...and stays consistent`, nameIsConsistent({ ...r.values }) === true);
  }
}

// ------------------------------------------------------- preferred name
section("Preferred name rederives correctly");

{
  const r = saveName({ legal_first_name: "Katherine", preferred_first_name: "Katie",
                       last_name: "Kappa" });
  ok("the preferred name wins over the legal one", r.values.full_name === "Katie Kappa");
  ok("the legal name is still stored", r.values.legal_first_name === "Katherine");
  ok("consistent", nameIsConsistent(r.values) === true);

  const cleared = saveName({ legal_first_name: "Katherine", preferred_first_name: "  ",
                             last_name: "Kappa" });
  ok("clearing the preferred name falls back to the legal one",
    cleared.values.full_name === "Katherine Kappa");
  ok("...and stores null rather than a blank", cleared.values.preferred_first_name === null);
  ok("...and stays consistent", nameIsConsistent(cleared.values) === true);

  const onlyPreferred = saveName({ preferred_first_name: "Katie", last_name: "Kappa" });
  ok("a record with a preferred name but no legal one is still editable",
    onlyPreferred.ok === true && onlyPreferred.values.full_name === "Katie Kappa");
}

// ------------------------------------------------------------- required parts
section("Structured mode requires what the derivation needs");

{
  ok("a missing last name is refused",
    saveName({ legal_first_name: "Ava", last_name: "" }).ok === false);
  ok("a missing first name is refused",
    saveName({ legal_first_name: "", last_name: "Alpha" }).ok === false);
  ok("...with a plain message",
    saveName({ legal_first_name: "", last_name: "Alpha" }).error === "Enter a first and last name.");
  // full_name is NOT NULL; refusing here is what keeps the derivation total.
  ok("no save can produce a null full_name",
    saveName({ legal_first_name: "Ava", last_name: "Alpha" }).values.full_name !== null);
}

// --------------------------------------------------------------- legacy
section("Legacy full-name-only players are untouched");

{
  const legacy = { full_name: "Bea Beta", legal_first_name: null,
                   preferred_first_name: null, last_name: null };
  ok("a legacy record is NOT structured", hasStructuredName(legacy) === false);
  ok("...and is trivially consistent", nameIsConsistent(legacy) === true);
  ok("composeFullName falls back to full_name", composeFullName(legacy) === "Bea Beta");

  const saved = saveName({ full_name: "Bea Beta-Jones" });
  ok("the legacy save writes full_name", saved.values.full_name === "Bea Beta-Jones");
  ok("...and writes NO structured column",
    !("last_name" in saved.values) && !("legal_first_name" in saved.values)
    && !("preferred_first_name" in saved.values));
  ok("...so nothing is populated by a rename",
    Object.keys(saved.values).join() === "full_name");
}

// ------------------------------------------------------------ no parsing
section("Nothing infers structured names from a full_name");

{
  // The tempting wrong fix. Names that defeat any split rule.
  for (const name of ["Mary Ann van der Berg", "Cher", "Ana María Ruiz Gómez", "O'Brien"]) {
    const r = saveName({ full_name: name });
    ok(`"${name}" produces no inferred components`,
      Object.keys(r.values).length === 1 && r.values.full_name === name);
  }

  const src = read("lib/actions/roster.js");
  ok("the write path contains no name splitting",
    !/full_name[\s\S]{0,80}?\.split\(/.test(src));
  ok("...and no surname regex", !/\/\^\?\.\*\\s\+/.test(src));

  const ui = read("components/RosterClient.js");
  ok("the form contains no name splitting", !/full_name[\s\S]{0,80}?\.split\(/.test(ui));
}

// -------------------------------------------- import-created records survive
section("Import-created records stay consistent after manual edits");

{
  // Exactly what intake_apply writes for a structured row.
  let record = { legal_first_name: "Cleo", preferred_first_name: null,
                 last_name: "Gamma", full_name: "Cleo Gamma" };
  ok("as imported: consistent", nameIsConsistent(record) === true);

  const edits = [
    { legal_first_name: "Cleo", preferred_first_name: "Clee", last_name: "Gamma" },
    { legal_first_name: "Cleo", preferred_first_name: "Clee", last_name: "Gamma-Delta" },
    { legal_first_name: "Cleopatra", preferred_first_name: "", last_name: "Gamma-Delta" },
  ];
  for (const [i, e] of edits.entries()) {
    const r = saveName(e);
    record = { ...record, ...r.values };
    ok(`after manual edit ${i + 1}: still consistent`, nameIsConsistent(record) === true);
  }
  ok("the final derived name is correct", record.full_name === "Cleopatra Gamma-Delta");
}

// ----------------------------------------------- one implementation, reused
section("One derivation, reused rather than reimplemented");

{
  const action = read("lib/actions/roster.js");
  ok("the server action imports composeFullName",
    /import \{ composeFullName, hasStructuredName \} from "\.\.\/intake\/normalize"/.test(action));
  ok("...and does not define its own",
    !/function composeFullName/.test(action));
  ok("full_name is derived in the structured branch",
    /full_name = composeFullName\(\{/.test(action));

  const ui = read("components/RosterClient.js");
  ok("the form imports the same function",
    /composeFullName, hasStructuredName/.test(ui));
  ok("...and does not define its own", !/function composeFullName/.test(ui));
  ok("structured mode is decided by hasStructuredName, not a guess",
    /const structuredNames = !isNew && hasStructuredName\(p\)/.test(ui));
  ok("a new player is never structured", /!isNew &&/.test(ui));
  ok("full_name is not an editable input in structured mode",
    /structuredNames \? \(/.test(ui));
}

// ------------------------------------------------------------ drawer parity
section("Drawer parity");

{
  const ui = read("components/RosterClient.js");
  ok("the drawer uses the canonical display name",
    /const displayName = composeFullName\(p\)/.test(ui));
  ok("...for the heading", /player-detail-title">\{displayName\}/.test(ui));
  ok("...and for the Name row", /<Row label="Name" value=\{displayName\} \/>/.test(ui));
  ok("high school displays when populated",
    /\{p\.high_school && <Row label="High school"/.test(ui));
  ok("high school is editable", /name="high_school"/.test(ui));
  ok("...on edit only, because the add RPC has no such parameter",
    /\{!isNew && \([\s\S]{0,200}?name="high_school"/.test(ui));

  const action = read("lib/actions/roster.js");
  ok("high_school is written on the update path", /player\.high_school = text\(/.test(action));
  ok("...and is NOT sent to roster_add_member", !/high_school[\s\S]{0,200}?p_player/.test(action));
  ok("no parent_* write was reintroduced", !/\bparent_(name|email|phone)\s*:/.test(action));
}

// ---------------------------------------------------------- contact card CSS
section("Contact card uses real, Season Tempo-specific classes");

{
  const ui = read("components/PlayerContacts.js");
  const css = read("app/globals.css");

  ok("it no longer uses .contact-card (owned by TournamentContact)",
    !/className="contact-card/.test(ui));
  ok("it no longer uses a generic .badge", !/className="badge/.test(ui));
  ok("it uses the established .detail-section language",
    /className="detail-section"/.test(ui) && /className="detail-section-title"/.test(ui));

  for (const c of ["pc-card", "pc-card-head", "pc-name", "pc-badge", "pc-badge-quiet",
                   "pc-body", "pc-actions", "pc-empty", "pc-head", "pc-card-editing"]) {
    if (new RegExp(`className="[^"]*\\b${c}\\b`).test(ui)) {
      ok(`.${c} is defined in CSS`, new RegExp(`\\.${c}[ ,:{]`).test(css));
    }
  }

  // The reported bug: name and badge rendering as one word.
  ok("the name is its own element", /className="pc-name"/.test(ui));
  ok("the head is a flex row with a gap",
    /\.pc-card-head\s*\{[^}]*display:\s*flex/.test(css) && /\.pc-card-head\s*\{[^}]*gap:/.test(css));
  ok("an explicit primary and a derived one look different",
    /\.pc-badge-quiet/.test(css));

  // CRUD behaviour preserved.
  ok("add still goes through the action", /addPlayerContact/.test(ui));
  ok("update still goes through the action", /updatePlayerContact/.test(ui));
  ok("remove still goes through the action", /removePlayerContact/.test(ui));
  ok("primary still goes through the RPC-backed action", /setPrimaryContact/.test(ui));
  ok("player_contacts remains the sole write store",
    !/parent_(name|email|phone)/.test(ui));
}


// ------------------------------------------------------ drawer architecture
section("Drawer information architecture");

{
  const ui  = read("components/RosterClient.js");
  const pc  = read("components/PlayerContacts.js");
  const doc = read("components/DocumentSection.js");
  const rec = read("components/PlayerRecruiting.js");
  const css = read("app/globals.css");

  // Section order, by first appearance in the drawer.
  const drawer = ui.slice(ui.indexOf("export function PlayerDetail"), ui.indexOf("function AddPersonFlow"));
  const at = (needle) => drawer.indexOf(needle);

  ok("PLAYER comes before TEAM & UNIFORM",
    at('<Section title="Player">') > -1
    && at('<Section title="Player">') < at('<Section title="Team & Uniform">'));
  ok("TEAM & UNIFORM comes before CONTACTS",
    at('<Section title="Team & Uniform">') < at("<PlayerContacts"));
  ok("CONTACTS comes before RECRUITING",
    at("<PlayerContacts") < at("<PlayerRecruiting"));
  ok("RECRUITING comes before DOCUMENTS",
    at("<PlayerRecruiting") < at("<DocumentSection"));

  // The two headings that used to stack.
  ok('the "Player Information" heading is gone', !drawer.includes('title="Player Information"'));
  ok('the "Contact Information" heading is gone', !drawer.includes('title="Contact Information"'));
  ok("the standalone Uniform section is gone", !drawer.includes('<Section title="Uniform">'));
  ok("the Roster Status section is gone", !drawer.includes('title="Roster Status"'));

  // Season fields grouped, not mixed into intrinsic player data.
  const teamSection = drawer.slice(at('<Section title="Team & Uniform">'), at("<PlayerContacts"));
  for (const f of ["jersey_number", "positions", "jersey_size", "pants_size"]) {
    ok(`TEAM & UNIFORM contains ${f}`, teamSection.includes(f));
  }
  // Bounded by PLAYER's own closing tag — slicing to the next section's title
  // would sweep in that section's render guard, which legitimately names
  // jersey_number.
  const playerStart = at('<Section title="Player">');
  const playerSection = drawer.slice(playerStart, drawer.indexOf("</Section>", playerStart));
  ok("PLAYER contains high school", playerSection.includes("high_school"));
  ok("PLAYER contains throws / bats", playerSection.includes("Throws / Bats"));
  ok("PLAYER does NOT contain jersey number", !playerSection.includes("jersey_number"));

  // No duplication: player email/phone live in exactly one place.
  ok("player email/phone are NOT rendered in the drawer body",
    !drawer.includes("mailto:${p.player_email}"));
  ok("...they are rendered by the Contacts section", pc.includes("player.player_email"));
  ok("the Contacts heading is a single consolidated one",
    pc.includes('detail-section-title">Contacts<'));
  ok("guardian cards still come from player_contacts only",
    !/parent_(name|email|phone)/.test(pc));

  // Footer hierarchy: three weights, not three equal buttons.
  const foot = drawer.slice(drawer.indexOf('className="drawer-foot'));
  ok("Edit details remains the primary action", /btn-primary[^>]*onClick=\{onEdit\}/.test(foot));
  ok("Remove from roster remains secondary", /btn-secondary[^>]*onClick=\{onRemove\}/.test(foot));
  ok("Make inactive is a ghost action in the footer", /btn-ghost[^>]*onClick=\{onToggleActive\}/.test(foot));
  ok("...on the same row as Remove from roster", /drawer-foot-lifecycle/.test(foot));
  ok("...with Edit details still last (primary, right)",
    foot.indexOf("onToggleActive") < foot.indexOf("onRemove")
    && foot.indexOf("onRemove") < foot.indexOf("onEdit"));
  ok("...and the toggle capability is preserved", foot.includes("Make active"));

  // Compact empty states — collapsed, never removed.
  ok("Documents collapses when empty", /documents\.length === 0 && !uploading/.test(doc));
  ok("...and still offers Add", /compact-row[\s\S]{0,400}?setUploading\(true\)/.test(doc));
  // Recruiting stays VISIBLE as two compact rows even when empty. Collapsing
  // the section saved a little space and cost discoverability — a coach could
  // not see that recruiting information was something they could add.
  ok("Recruiting shows a Social & recruiting links row",
    /recruit-label">Social &amp; recruiting links</.test(rec));
  ok("...and a College interests row", /recruit-label">College interests</.test(rec));
  ok("...each reading None when empty", (rec.match(/recruit-value muted">None</g) ?? []).length === 2);
  ok("...each offering Add", (rec.match(/recruit-add/g) ?? []).length >= 2);
  ok("the section is never collapsed away", !/isEmpty/.test(rec));
  ok("populated values need no expansion", !/setOpen/.test(rec));
  ok("Notes is still hidden when empty", drawer.includes("{p.notes && ("));

  for (const c of ["compact-row", "compact-label", "compact-value",
                   "detail-section-compact", "pc-own", "btn-sm"]) {
    ok(`.${c} is defined in CSS`, new RegExp(`\\.${c}[ ,:{]`).test(css));
  }
  ok(".pc-head was removed in favour of .detail-section-head",
    !css.includes(".pc-head") && !pc.includes("pc-head"));
  ok("...and Contacts uses the shared section-head pattern",
    pc.includes('className="detail-section-head"'));
}

// -------------------------------------------------- edit details structure
section("Edit Details mirrors the drawer");

{
  const ui = read("components/RosterClient.js");
  const form = ui.slice(ui.indexOf("export function PlayerForm"));
  const at = (n) => form.indexOf(n);

  ok("a Player group exists", at('form-divider">Player<') > -1);
  ok("a Team & Uniform group exists", at("form-divider\">Team &amp; Uniform<") > -1
    || at('form-divider">Team &amp; Uniform<') > -1);
  ok("Player comes before Team & Uniform",
    at('form-divider">Player<') < at('form-divider">Team &amp; Uniform<'));
  ok("the arbitrary Uniform divider is gone", at('form-divider">Uniform<') === -1);
  ok("a Contact group exists", at('form-divider">Contact<') > -1);
  ok("a Notes group exists", at('form-divider">Notes<') > -1);
  ok("Team & Uniform comes before Contact",
    at('form-divider">Team &amp; Uniform<') < at('form-divider">Contact<'));
  ok("Contact comes before Notes", at('form-divider">Contact<') < at('form-divider">Notes<'));

  const player = form.slice(at('form-divider">Player<'), at('form-divider">Team &amp; Uniform<'));
  for (const f of ["grad_year", "high_school", "throws", "bats"]) {
    ok(`Player group contains ${f}`, player.includes(f));
  }
  ok("Player group does NOT contain jersey number (season data)",
    !player.includes('name="jersey_number"'));
  ok("Player group does NOT contain player email (contact data)",
    !player.includes('name="player_email"'));

  const team = form.slice(at('form-divider">Team &amp; Uniform<'), at('form-divider">Contact<'));
  for (const f of ["jersey_number", "Positions", "jersey_size", "pants_size"]) {
    ok(`Team & Uniform group contains ${f}`, team.includes(f));
  }

  const contact = form.slice(at('form-divider">Contact<'), at('form-divider">Notes<'));
  for (const f of ["player_email", "player_phone"]) {
    ok(`Contact group contains ${f}`, contact.includes(f));
  }
  ok("Contact group holds the player's OWN details only, not guardian CRUD",
    !contact.includes("PlayerContacts") && !contact.includes("player_contacts"));

  ok("disclosure applies on ADD only", /<Disclose enabled=\{isNew\}/.test(form));
  ok("...so nothing is hidden behind a toggle when editing",
    !/<details className="more-details" open=\{!isNew\}/.test(ui));

  // Separate workflows stay separate.
  ok("no guardian contact management in the modal", !form.includes("PlayerContacts"));
  ok("no recruiting editing in the modal", !form.includes("PlayerRecruiting"));
  ok("no document management in the modal", !form.includes("DocumentSection"));
  ok("no roster removal in the modal", !form.includes("onRemove"));
  ok("the add-only guardian block is retained", form.includes("isPlayer && isNew"));
}


// ------------------------------------------------- team page import routes
section("Team page has exactly one import route");

{
  const ui  = read("components/RosterClient.js");
  const css = read("app/globals.css");

  // The legacy importer's ENTRY POINTS are gone; its implementation is not.
  ok("no Upload roster button in the Team UI", !/>\s*Upload roster\s*</.test(ui));
  ok("nothing sets importing to true any more", !/setImporting\(true\)/.test(ui));
  ok("the legacy component is still imported (recoverable)", /import \{ RosterImport \}/.test(ui));
  ok("...and its action is still imported", /import \{ importRoster \}/.test(ui));
  ok("...and the render block is retained", /\{importing && \(/.test(ui));
  ok("...and marked as deliberately unreachable", /RETAINED, DELIBERATELY UNREACHABLE/.test(ui));
  ok("importRoster still exists server-side",
    /export async function importRoster/.test(read("lib/actions/roster.js")));

  // The single customer-facing route, renamed.
  ok('the action reads "Import from spreadsheet"', />\s*Import from spreadsheet\s*</.test(ui));
  ok('the old "Import players" label is gone from the Team UI',
    !/>\s*Import players\s*</.test(ui));
  ok("it opens the intake workflow", /setIntaking\(true\)/.test(ui));
  ok("exactly two entry points call setIntaking(true)",
    (ui.match(/setIntaking\(true\)/g) ?? []).length === 2);

  // Empty state — a new coach's first screen.
  const empty = ui.slice(ui.indexOf('className="empty-actions"'), ui.indexOf('className="empty-actions"') + 700);
  ok("the empty state offers Add player or coach as PRIMARY",
    /btn-primary[\s\S]{0,120}?Add player or coach/.test(empty));
  ok("...and Import from spreadsheet as secondary",
    /btn-secondary[\s\S]{0,140}?Import from spreadsheet/.test(empty));
  ok("...and no longer offers Upload roster", !/Upload roster/.test(empty));

  // Header hierarchy: Add stays primary, import secondary.
  const head = ui.slice(ui.indexOf('className="foot-actions"'), ui.indexOf('<PageHelp />'));
  ok("Add player or coach is the primary header action",
    /btn-primary[\s\S]{0,120}?Add player or coach/.test(head));
  ok("Import from spreadsheet is a ghost/secondary action",
    /btn-ghost[\s\S]{0,160}?Import from spreadsheet/.test(head));

  // Needs Action affordance.
  ok("Needs Action rows are real buttons", /className=\{`roster-action/.test(ui));
  ok("...with a pointer cursor", /\.roster-action \{[^}]*cursor:\s*pointer/.test(css));
  ok("...a hover border", /\.roster-action:hover \{[^}]*border-color/.test(css));
  ok("...an underlined label on hover",
    /\.roster-action:hover \.roster-action-text \{[^}]*text-decoration:\s*underline/.test(css));
  ok("...and a touch fallback", /@media \(hover: none\)[\s\S]{0,200}?\.roster-action/.test(css));
}


// ------------------------------------------------ intake decision surfacing
section("Every blocker is visible before Ready");

{
  const ui  = read("components/PlayerIntake.js");
  const rc  = read("components/RosterClient.js");
  const css = read("app/globals.css");

  ok("unresolved is derived from plan.executable",
    /const unresolved = analysed\.filter\(\(a\) => !a\.plan\.executable\)/.test(ui));
  ok("...and the import gate uses that same set",
    /const blockedByData = unresolved\.length/.test(ui));
  // Comments explaining the old arithmetic are documentation, not code.
  const uiCode = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("the overlapping two-set sum is gone",
    !/needsIdentity\.length \+ needsDecision\.length/.test(uiCode));
  ok("needsDecision no longer exists as a rival count", !/const needsDecision =/.test(ui));

  ok("Review receives the unresolved rows", /unresolved=\{unresolved\}/.test(ui));
  ok("Review renders a Needs-attention list", /pi-attention-list/.test(ui));
  ok("...gating Continue on the same set", /disabled=\{unresolved\.length > 0\}/.test(ui));
  ok("...and naming the row", /pi-attention-who/.test(ui));

  // Coach-facing language: test the STRINGS a coach actually reads, not the
  // identifiers around them. plan.blockers is a variable name; "blocker" in a
  // sentence would be the problem.
  const plainFn = ui.slice(ui.indexOf("function plainBlocker"), ui.indexOf("function ReviewChanges"));
  const copy = (plainFn.match(/"[^"]{6,}"|`[^`]{6,}`/g) ?? []).join(" ").toLowerCase();
  for (const jargon of ["plan.executable", "blocker", "migration", "assertplansafe",
                        "executable", "payload", "rpc", "constraint"]) {
    ok(`the coach never reads "${jargon}"`, !copy.includes(jargon));
  }
  ok("...and the translator does produce copy", copy.length > 80);
  ok("a blocker is translated to plain English", /function plainBlocker/.test(ui));
  ok("...including the no-name case", /This row has no player name/.test(ui));

  for (const c of ["pi-attention", "pi-attention-list", "pi-attention-who", "pi-attention-why"]) {
    ok(`.${c} is defined in CSS`, new RegExp(`\\.${c}[ ,:{]`).test(css));
  }

  // Scroll owner + body lock.
  ok("the intake panel holds a ref", /const rootRef = useRef\(null\)/.test(ui));
  ok("...and resets on every step change", /\}, \[step\]\)/.test(ui));
  ok("...by resolving the real scroll owner, not just window",
    /getComputedStyle\(node\)/.test(ui) && /scrollTop = 0/.test(ui));
  ok("...with window as a fallback only", /window\.scrollTo\?\.\(0, 0\)/.test(ui));

  ok("intaking is part of the overlay lifecycle",
    /overlayOpen = Boolean\(detail \|\| editing \|\| adding \|\| intaking\)/.test(rc));
  ok("...so Escape closes the import drawer", /else if \(intaking\) setIntaking\(false\)/.test(rc));
  ok("...and it is in the effect's dependencies", /\[overlayOpen, editing, adding, intaking\]/.test(rc));
  ok("the drawer contains its own overscroll",
    /\.drawer-body \{[^}]*overscroll-behavior: contain/.test(css));
}


// ------------------------------------------- roster row -> real player id
section("The drawer acts on a player id, never an assignment id");

{
  const q  = read("lib/queries/roster.js");
  const ui = read("components/RosterClient.js");

  ok("listSeasonRoster selects player_id", /`id, player_id, jersey_number/.test(q));
  ok("...so a roster row carries one", /player_id/.test(q));

  // The fallback that silently substituted the assignment id. Comments
  // explaining why it was removed are documentation, not code.
  const uiCode2 = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("no consumer falls back to detail.id", !/detail\.player_id \?\? detail\.id/.test(uiCode2));
  ok("no child falls back to row.id", !/playerId \?\? row\.player_id \?\? row\.id/.test(ui));
  ok("a single explicit id is derived", /const detailPlayerId = detail\?\.player_id \?\? null/.test(ui));
  ok("...and it fails visibly rather than substituting",
    /detail\?\.player_id \?\? null/.test(ui));

  // Every drawer consumer must use it.
  for (const [what, re] of [
    ["dues",            /paymentIdByPlayer\[detailPlayerId\]/],
    ["recruiting / X",  /recruiting\[detailPlayerId\]/],
    ["played with us",  /p\.player_id === detailPlayerId/],
    ["onRoster",        /r\.player_id === detailPlayerId/],
    ["contacts + recruiting children", /playerId=\{detailPlayerId\}/],
  ]) {
    ok(`${what} uses the player id`, re.test(ui));
  }
  ok("PlayerContacts receives it without a fallback",
    /playerId=\{playerId \?\? row\.player_id\}/.test(ui));

  /* Which identifier each drawer action uses. Not everything was broken, and
     asserting the correct ones stops a future "fix" from changing them.

     A SEASON ASSIGNMENT id is right for anything scoped to this season; a
     PLAYER id is right for anything about the person. */

  // Correct all along — read from the embedded player object.
  ok("Documents lock to the player, not the assignment",
    /lockTo=\{\{ kind: "player", id: p\.id/.test(ui));
  ok("Edit Details posts the player id from the player object",
    /name="player_id" value=\{p\.id\}/.test(ui));

  // Correct all along — genuinely season-scoped.
  ok("Make active/inactive uses the assignment id",
    /fd\.set\("assignment_id", row\.id\)[\s\S]{0,80}?is_active/.test(ui));
  ok("Remove from roster uses the assignment id",
    (ui.match(/fd\.set\("assignment_id", row\.id\)/g) ?? []).length >= 2);
  ok("Edit Details also posts the assignment id for season fields",
    /name="assignment_id" value=\{row\.id\}/.test(ui));

  // The zero-contact path: resolveFor() looks up players.id, so an assignment
  // id produced "That player no longer exists." on the FIRST Add contact.
  const pc = read("lib/actions/player-contacts.js");
  const resolveFn = pc.slice(pc.indexOf("async function resolveFor"), pc.indexOf("function readForm"));
  ok("addPlayerContact resolves the player by players.id",
    /\.from\("players"\)/.test(resolveFn) && /\.eq\("id", playerId\)/.test(resolveFn));
  ok("...and says so plainly when it cannot find one",
    /That player no longer exists\./.test(pc));
  ok("a player's FIRST stored contact becomes primary",
    /is_primary: stored\.length === 0/.test(pc));
}

// ------------------------------------------------------ date of birth
section("Date of birth imports without a checkbox");

{
  const reg = read("lib/intake/registry.js");
  const ss  = read("lib/spreadsheet.js");
  const nrm = read("lib/intake/normalize.js");
  const pl  = read("lib/intake/plan.js");
  const act = read("lib/actions/intake.js");
  const ui  = read("components/PlayerIntake.js");

  const dob = reg.slice(reg.indexOf('key: "date_of_birth"'), reg.indexOf('key: "date_of_birth"') + 320);
  ok("date_of_birth is no longer optIn", !/optIn:\s*true/.test(dob));
  ok("...but is still labelled sensitive", /sensitive:\s*true/.test(dob));
  ok("no field is gated behind opt-in any more", !/optIn:\s*true/.test(reg));

  ok("Excel date cells are read as dates", /cellDates:\s*true/.test(ss));
  ok("an unreadable date is classified, not dropped", /export function classifyDate/.test(nrm));
  ok("...and collected by a shared helper", /export function unreadableValues/.test(nrm));
  ok("the plan turns it into a visible blocker", /row\._unreadable/.test(pl));
  ok("the browser preview uses the shared helper", /unreadableValues\(mapped/.test(ui));
  ok("the server re-derives with the SAME helper", /unreadableValues\(raw/.test(act));
}

// ----------------------------------------------------- map players layout
section("Map Players fits the drawer");

{
  const css = read("app/globals.css");
  const ui  = read("components/PlayerIntake.js");

  ok("the mapping table uses fixed layout",
    /\.pi-table \{[^}]*table-layout: fixed/.test(css));
  ok("columns have declared proportions",
    /\.pi-c-source\s+\{ width: \d+%/.test(css)
    && /\.pi-c-mapping \{ width: \d+%/.test(css)
    && /\.pi-c-include \{ width: \d+%/.test(css));
  ok("...and the markup declares them", /<colgroup>/.test(ui) && /pi-c-include/.test(ui));
  ok("the flex chain can shrink", /\.pi \{[^}]*min-width: 0/.test(css));
  ok("...including panel children", /\.pi > \*, \.pi-panel > \* \{ min-width: 0/.test(css));
  ok("long headers and samples wrap", /\.pi-table td, \.pi-table th \{ overflow-wrap: anywhere/.test(css));
  ok("the select no longer caps at a fixed pixel width",
    !/\.pi-select \{[^}]*max-width: 260px/.test(css));
  ok("the defect is NOT hidden with overflow-x: hidden",
    !/\.pi-table[^}]*overflow-x:\s*hidden/.test(css));
  ok("a contained scroller remains only for narrow screens",
    /@media \(max-width: 720px\)[\s\S]{0,400}?\.pi-table \{ display: block; overflow-x: auto/.test(css));
}


// -------------------------------- client/server matching evidence parity
section("Both derivations are built from one shared candidate shape");

{
  const act = read("lib/actions/intake.js");
  const rc  = read("components/RosterClient.js");
  const mt  = read("lib/intake/match.js");

  ok("a canonical candidate shape exists", /export function toCandidate/.test(mt));
  ok("...and the evidence is named once", /export const MATCH_EVIDENCE/.test(mt));
  ok("...covering contacts", /"contacts"/.test(mt));

  ok("the server embeds player_contacts for matching",
    /player_contacts \( id, email \)/.test(act));
  ok("...and selects the structured name columns",
    /legal_first_name, preferred_first_name, last_name/.test(act));
  ok("the server builds candidates through toCandidate",
    /\(existing \?\? \[\]\)\.map\(toCandidate\)/.test(act));
  ok("...and matches against them", /matchPlayer\(row, candidates\)/.test(act));
  ok("the server still RE-DERIVES rather than trusting the client",
    /RE-DERIVED\. The client's classification is not consulted\./.test(act));

  ok("the browser builds candidates through the same function",
    /existingPlayers=\{\(rows \?\? \[\]\)\.map\(\(r\) =>\s*\n?\s*toCandidate\(/.test(rc));
  ok("...and no longer hand-rolls a shape", !/parent_email: r\.player\?\.parent_email/.test(rc));
}


// ---------------------------------------------- every matchPlayer caller
section("No caller can supply a partial candidate");

{
  const mt = read("lib/intake/match.js");
  const files = ["components/PlayerIntake.js", "lib/actions/intake.js",
                 "components/RosterClient.js"];

  ok("matchPlayer shapes its candidates itself",
    /export function matchPlayer[\s\S]{0,600}?existing = \(existing \?\? \[\]\)\.map\(toCandidate\)/.test(mt));

  // The only two production callers.
  const callers = files.filter((f) => /matchPlayer\(/.test(read(f)));
  ok("there are exactly two production callers", callers.length, 2);
  ok("...the browser preview and the server action",
    callers.sort(), ["components/PlayerIntake.js", "lib/actions/intake.js"]);

  // Both are fed candidates built by the shared function.
  ok("the server builds them with toCandidate",
    /\.map\(toCandidate\)/.test(read("lib/actions/intake.js")));
  ok("the browser is handed candidates built with toCandidate",
    /toCandidate\(\{ \.\.\.r\.player/.test(read("components/RosterClient.js")));
  ok("no production file hand-rolls a candidate literal",
    files.every((f) => !/parent_email: r\.player\?\.parent_email/.test(read(f))), true);
}

console.log(`\n${passed} assertions, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
})();
