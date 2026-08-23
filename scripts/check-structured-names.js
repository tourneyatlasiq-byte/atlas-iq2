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

console.log(`\n${passed} assertions, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
})();
