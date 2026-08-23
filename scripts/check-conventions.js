/**
 * Atlas IQ — convention checks.
 *
 * Static assertions for the class of bug the syntax check cannot catch: an
 * identifier that does not exist, a component used without its import, or a
 * module quietly drifting from a shared pattern.
 *
 * Every rule here exists because something broke in production:
 *   - `useOpenParam(rows, …)` in a module whose prop is `tournaments`
 *   - `<Link>` used without importing it
 *   - two sources of truth for drawer state
 *
 * Run:  npm run check
 */

const fs = require("fs");
const path = require("path");

const failures = [];
const notes = [];

function read(f) {
  return fs.readFileSync(path.join("components", f), "utf8");
}

function componentFiles() {
  return fs.readdirSync("components").filter((f) => f.endsWith(".js"));
}

/* ---- 1. Drawer state: one pattern, no local mirror ---------------------- */

const DRAWER_MODULES = [
  ["TournamentClient.js", "tournaments", "detail"],
  ["FacilitiesClient.js", "facilities", "detail"],
  ["RosterClient.js", "openable", "detail"],
  ["FilesClient.js", "documents", "detail"],
  ["FinanceClient.js", "payments", "detailPay"],
];

for (const [file, source, name] of DRAWER_MODULES) {
  const s = read(file);

  if (!s.includes(`useOpenParam(${source})`)) {
    failures.push(`${file}: useOpenParam is not called with \`${source}\``);
  }

  // The argument must actually exist — either a prop or an earlier const.
  const sigStart = s.indexOf(`export function ${file.replace(".js", "")}(`);
  const sig = s.slice(sigStart, s.indexOf(") {", sigStart));
  const isProp = sig.includes(source);
  const declPos = s.indexOf(`const ${source} =`);
  const callPos = s.indexOf(`useOpenParam(${source}`);
  if (!isProp && !(declPos > -1 && declPos < callPos)) {
    failures.push(`${file}: \`${source}\` is neither a prop nor declared before useOpenParam`);
  }

  if (new RegExp(`const \\[${name},\\s*set`).test(s)) {
    failures.push(`${file}: local drawer state \`${name}\` still exists — the URL must be the only source`);
  }

  if (!s.includes("closeDetail(")) {
    failures.push(`${file}: never calls closeDetail — ?open would persist after closing`);
  }
}

/* ---- 2. Imports match usage -------------------------------------------- */

for (const f of componentFiles()) {
  const s = read(f);
  if (s.includes("<Link") && !s.includes('from "next/link"')) {
    failures.push(`${f}: uses <Link> without importing it`);
  }
  if (s.includes("<RelatedLink") && !s.includes('from "./RelatedLink"')) {
    failures.push(`${f}: uses <RelatedLink> without importing it`);
  }
  if (/\buseState\(/.test(s) && !/import \{[^}]*useState/.test(s)) {
    failures.push(`${f}: uses useState without importing it`);
  }
  if (s.includes('"use client"') && s.includes("lib/queries/")) {
    failures.push(`${f}: client component imports a server query module`);
  }
}

/* ---- 3. Server actions export only async functions --------------------- */

for (const f of fs.readdirSync("lib/actions").filter((x) => x.endsWith(".js"))) {
  const s = fs.readFileSync(path.join("lib/actions", f), "utf8");
  if (!s.startsWith('"use server"')) continue;
  const bad = s.match(/^export (const|function|let|var|class) /m);
  if (bad) {
    failures.push(`lib/actions/${f}: "use server" files may only export async functions`);
  }
}

/* ---- 4. Table headers and cells must line up --------------------------- */

for (const f of componentFiles()) {
  const s = read(f);
  const th = (s.match(/<th[ >]/g) || []).length;
  const td = (s.match(/<td[ >]/g) || []).length;
  // Only meaningful where a file has a single table; note rather than fail.
  if (th > 0 && Math.abs(th - td) > 2) {
    notes.push(`${f}: ${th} <th> vs ${td} <td> — verify each table's columns align`);
  }
}

/* ---- 4b. Selection state must not key on a field the query never returns --
   listSeasonRoster returns `id` and a nested `player` object, never
   `player_id`. Keying React state on r.player_id gave every row the same
   undefined key: clicking one checked them all. */

for (const f of componentFiles()) {
  const s2 = read(f);
  // Scope to the function that receives seasonRoster, not a fixed window.
  // tournament_participants rows legitimately have player_id, so matching the
  // whole file would be a false positive.
  const fnStart = s2.indexOf("function SetEventRosterSheet");
  if (fnStart > -1) {
    const nextFn = s2.indexOf("\nfunction ", fnStart);
    const body = s2
      .slice(fnStart, nextFn === -1 ? s2.length : nextFn)
      // Strip comments: the note explaining this very bug mentions the string.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    if (/\br\.player_id\b/.test(body)) {
      failures.push(`${f}: keys on r.player_id where seasonRoster is used — that query returns r.player.id`);
    }
  }
}

/* ---- 4c. CSV must not depend on the Excel path ------------------------
   Excel loads SheetJS from a CDN on demand. If the CSV branch ever starts
   awaiting that loader, a CDN outage would take working CSV imports with it. */

{
  const sp = fs.readFileSync("lib/spreadsheet.js", "utf8");

  const csvFn = sp.slice(sp.indexOf("export function csvToGrid"), sp.indexOf("export async function readSpreadsheet"));
  if (/loadSheetJs|XLSX/.test(csvFn)) {
    failures.push("lib/spreadsheet.js: the CSV parser references the Excel loader");
  }

  const reader = sp.slice(sp.indexOf("export async function readSpreadsheet"), sp.indexOf("export async function downloadTemplate"));
  const csvBranch = reader.slice(0, reader.indexOf('name.endsWith(".xlsx")'));
  if (/loadSheetJs/.test(csvBranch)) {
    failures.push("lib/spreadsheet.js: the CSV branch awaits SheetJS — a CDN outage would break CSV");
  }

  if (!/csvToGrid|splitCsvLine/.test(sp)) {
    failures.push("lib/spreadsheet.js: the hand-written CSV parser is missing");
  }
}

/* ---- 4d. Import templates must match their parsers -------------------- */

{
  const fi = fs.readFileSync("lib/facility-import.js", "utf8");
  const fc = fs.readFileSync("components/FacilityImport.js", "utf8");
  const colsMatch = fi.match(/export const IMPORT_COLUMNS = \[([\s\S]*?)\n\]/);
  const exMatch = fc.match(/EXAMPLE_ROW = \[([\s\S]*?)\n\]/);
  if (colsMatch && exMatch) {
    const cols = (colsMatch[1].match(/"/g) || []).length / 2;
    const vals = (exMatch[1].match(/"/g) || []).length / 2;
    if (cols !== vals) {
      failures.push(`FacilityImport.js: template example has ${vals} values for ${cols} columns — columns would shift`);
    }
  }
}

/* ---- 4e. A prop that is passed must be used ---------------------------
   seasonOptions was threaded from the page into WelcomeForm and then never
   consumed, because a string replacement silently failed. The prop existed,
   the data flowed, and the control was still a text input. A destructured
   prop that appears exactly once in a component is a prop nobody uses. */

for (const f of componentFiles()) {
  const s2 = read(f);
  const sig = s2.match(/export function \w+\(\{([^}]*)\}\)/);
  if (!sig) continue;

  const props = sig[1]
    .split(",")
    .map((p) => p.trim().split(/[:=]/)[0].trim())
    .filter((p) => p && /^[a-z][A-Za-z0-9]*$/.test(p));

  // Strip comments first — a JSDoc line mentioning the prop is not a use, and
  // counting it is how this check silently passed on the bug it was written for.
  const body = s2
    .slice(s2.indexOf(sig[0]) + sig[0].length)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

  for (const prop of props) {
    const uses = (body.match(new RegExp(`\\b${prop}\\b`, "g")) || []).length;
    if (uses === 0) {
      failures.push(`${f}: prop \`${prop}\` is destructured but never used`);
    }
  }
}

/* ---- 4f. A component cannot read a column the query never selects ------
   TournamentContact read tournament.contact_id for a whole milestone while
   listTournaments never selected it, so the contact silently never appeared.
   The component was right, the action was right, the query was not. */

{
  const checks = [
    ["lib/queries/tournaments.js", ["contact_id", "facility:facilities", "provider:tournament_providers"]],
    // player_contacts: without the embed the resolver silently falls back to
    // the legacy columns for every player, which looks like working software.
    ["lib/queries/roster.js", ["jersey_number", "positions", "is_active", "player_contacts"]],
    ["lib/queries/participants.js", ["participation", "jersey_number"]],
    ["lib/queries/contacts.js", ["contact_category", "organization_or_school"]],
  ];

  for (const [file, columns] of checks) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    for (const col of columns) {
      if (!src.includes(col)) {
        failures.push(`${file}: does not select \`${col}\`, which the UI reads`);
      }
    }
  }
}

/* ---- 4g. Import templates must offer only columns the importer reads ---
   The roster template shipped 5 columns while the schema supported 14, so a
   coach's spreadsheet data was silently discarded. A template offering a
   column the importer ignores is worse than a missing column: it looks like
   it worked. */

{
  const pairs = [
    ["components/RosterImport.js", "lib/actions/roster.js"],
  ];

  for (const [templateFile, actionFile] of pairs) {
    if (!fs.existsSync(templateFile) || !fs.existsSync(actionFile)) continue;
    const t = fs.readFileSync(templateFile, "utf8");
    const a = fs.readFileSync(actionFile, "utf8");

    const block = t.match(/const COLUMNS = \[([\s\S]*?)\n\]/);
    if (!block) continue;
    const columns = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    for (const col of columns) {
      if (!a.includes(`raw.${col}`)) {
        failures.push(`${templateFile}: template offers "${col}" but ${actionFile} never reads it`);
      }
    }

    // Example row must align, or every column after a gap shifts.
    const ex = t.match(/const EXAMPLE_ROW = \[([\s\S]*?)\n\]/);
    if (ex) {
      const values = (ex[1].match(/"/g) || []).length / 2;
      if (values !== columns.length) {
        failures.push(`${templateFile}: example row has ${values} values for ${columns.length} columns`);
      }
    }
  }
}

/* ---- 4h. Money must never be truncated or blocked at entry -------------
   Five money inputs shipped with step="1", which makes the browser reject
   cents — a coach could not type 119.99 into a transaction amount. The value
   never arrived, so nothing was corrupted; it simply could not be entered. */

for (const f of componentFiles()) {
  const src = read(f);

  const inputs = src.match(/<input[^>]*type="number"[^>]*>/g) || [];
  for (const tag of inputs) {
    const isMoney = /name="(actual_amount|amount|initial_cost|budgeted|unit_cost|entry_fee|gate_fee|total_cost)"/.test(tag);
    if (isMoney && /step="1"/.test(tag)) {
      const name = (tag.match(/name="(\w+)"/) || [])[1];
      failures.push(`${f}: money input "${name}" uses step="1" — cents cannot be entered`);
    }
  }

  if (/maximumFractionDigits:\s*0/.test(src) && /money|amount|cost|owing|paid/i.test(src)) {
    failures.push(`${f}: a currency value is formatted with maximumFractionDigits: 0`);
  }
}

for (const f of ["lib/finance-rules.js", "lib/queries/finance.js", "lib/actions/finance.js"]) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  if (/Math\.floor|Math\.trunc/.test(src)) {
    failures.push(`${f}: floors or truncates — money rounds to the nearest cent, never down`);
  }
}

/* ---- 4i. A required prop must actually be passed by its page ----------
   isOwner was added to SettingsClient and never passed, so it defaulted to
   false and every user — including the owner — was told they could not change
   the logo. contacts was missing the same way, rendering an empty directory.
   Neither threw; both silently produced a wrong screen. */

{
  const pairs = [
    ["components/SettingsClient.js", "app/(app)/settings/page.js", "SettingsClient"],
    ["components/RosterClient.js", "app/(app)/team/page.js", "RosterClient"],
    ["components/TournamentClient.js", "app/(app)/tournaments/page.js", "TournamentClient"],
    ["components/FinanceClient.js", "app/(app)/finance/page.js", "FinanceClient"],
    ["components/DashboardClient.js", "app/(app)/dashboard/page.js", "DashboardClient"],
  ];

  for (const [comp, pagePath, name] of pairs) {
    if (!fs.existsSync(comp) || !fs.existsSync(pagePath)) continue;
    const src = fs.readFileSync(comp, "utf8");
    const page = fs.readFileSync(pagePath, "utf8");

    const sig = src.match(
      new RegExp("export function " + name + String.raw`\(\{([\s\S]*?)\}\)\s*\{`)
    );
    if (!sig) continue;

    // Only props without a default: an omitted default is intentional.
    const required = sig[1]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => /^[a-zA-Z]/.test(p) && !p.includes("="))
      .map((p) => p.split(":")[0].trim());

    for (const prop of required) {
      if (!page.includes(prop + "={")) {
        failures.push(`${pagePath}: does not pass required prop \`${prop}\` to ${name}`);
      }
    }
  }
}

/* ---- 4j. A JSX component must be defined or imported -----------------
   <PaymentNote /> was referenced twice and defined nowhere: the insert anchored
   on a function name that did not exist, matched nothing, and the file still
   parsed. Valid syntax, guaranteed runtime crash. */

for (const f of componentFiles()) {
  const src = read(f);
  const used = [...new Set([...src.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]))];

  for (const name of used) {
    const defined = new RegExp("function " + name + "\\b").test(src);
    const imported = new RegExp("import[^;]*\\b" + name + "\\b[^;]*from").test(src);
    const assigned = new RegExp("const " + name + "\\s*=").test(src);
    if (!defined && !imported && !assigned) {
      failures.push(`${f}: <${name}> is used but never defined or imported`);
    }
  }
}

/* ---- 4k. documentsByEntity returns a Map, not an array -----------------
   Calling .filter() on it threw on every facility click. It parsed, passed the
   syntax check and passed a prop-wiring check — nothing verified the shape of
   what the query returns. */

for (const f of ["app/(app)/facilities/page.js", "app/(app)/team/page.js",
                 "app/(app)/tournaments/page.js"]) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  if (!src.includes("documentsByEntity")) continue;

  const binding = (src.match(/(\w+)\s*\]\s*=\s*await Promise\.all/) || [])[1];
  if (!binding) continue;
}

/* Any component receiving a documents map must read it with .get(), never
   .filter() or .map(). */
for (const f of componentFiles()) {
  const src = read(f);
  const misuse = src.match(/(\w*[Dd]ocs)\s*\.\s*(filter|map)\(/);
  if (misuse && /Docs\s*=\s*new Map|Docs\?\.\s*get/.test(src)) {
    failures.push(`${f}: ${misuse[1]}.${misuse[2]}() — documentsByEntity returns a Map, use .get(id)`);
  }
}

/* ---- 5. Deprecated terminology ----------------------------------------- */

const RETIRED = [
  ["Funds In", "Money In"],
  ["Our Venues", "Our Facilities"],
  ["Add player payment", "Set player dues"],
  ["Add person", "Add player or coach"],
];

for (const f of componentFiles()) {
  const s = read(f);
  for (const [old, now] of RETIRED) {
    // Only flag user-facing strings, not comments explaining the change.
    const inString = new RegExp(`["'>][^"'<]*${old}`).test(s);
    if (inString) failures.push(`${f}: user-facing "${old}" — should be "${now}"`);
  }
}

/* ---- Report ------------------------------------------------------------ */

for (const n of notes) console.log(`  note  ${n}`);
for (const f of failures) console.log(`  FAIL  ${f}`);

console.log(
  failures.length
    ? `\n${failures.length} convention failure(s)`
    : `\nConventions OK${notes.length ? ` (${notes.length} note${notes.length > 1 ? "s" : ""})` : ""}`
);

process.exit(failures.length ? 1 : 0);
