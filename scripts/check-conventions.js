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
