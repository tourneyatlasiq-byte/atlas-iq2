/**
 * Release guard: app code must not depend on a pending migration (2026-11).
 *
 * Incident 2026-11-07: commit a7fbe24 shipped code that selects
 * budget_items.report_total_only while the migration adding that column was
 * still in supabase/pending/ (reviewed, not applied). Production had no such
 * column, so Home, Finance and Tournaments failed for every user until a
 * rollback.
 *
 * Rule: a column or table that is created ONLY by a file in supabase/pending/
 * — not by any file in supabase/migrations/ — must not be referenced by
 * application code (app/, components/, lib/). Apply the migration first; move
 * it into supabase/migrations/ under its recorded version; then ship the code.
 *
 * Pending files that duplicate an already-applied migration (such as an old
 * copy left in pending/) never trip the guard: their names are defined in
 * supabase/migrations/ too.
 *
 * Usage: node scripts/check-pending-columns.js [repo root]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.argv[2] ?? path.join(__dirname, ".."));
const strip = (sql) => sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const sqlIn = (dir) => {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith(".sql")).map((f) => ({ file: `${dir}/${f}`, sql: strip(fs.readFileSync(path.join(d, f), "utf8")) }));
};

/** Columns and tables a SQL text creates. */
function created(sql) {
  const out = [];
  for (const m of sql.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) out.push({ kind: "column", name: m[1].toLowerCase() });
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi)) out.push({ kind: "table", name: m[1].toLowerCase() });
  return out;
}

const pending = sqlIn("supabase/pending");
const migrations = sqlIn("supabase/migrations");
const migrationText = migrations.map((m) => m.sql).join("\n").toLowerCase();
const definedInMigrations = (name) => new RegExp(`\\b${name}\\b`).test(migrationText);

const pendingOnly = [];
for (const p of pending) {
  for (const c of created(p.sql)) {
    if (!definedInMigrations(c.name)) pendingOnly.push({ ...c, file: p.file });
  }
}

/** Every application source file. */
function walk(dir, acc = []) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, acc);
    else if (/\.(js|jsx|ts|tsx|mjs)$/.test(e.name)) acc.push(rel);
  }
  return acc;
}
const sources = ["app", "components", "lib"].flatMap((d) => walk(d)).map((f) => ({ file: f, text: fs.readFileSync(path.join(ROOT, f), "utf8") }));

const problems = [];
for (const c of pendingOnly) {
  const re = new RegExp(`\\b${c.name}\\b`);
  const users = sources.filter((s) => re.test(s.text)).map((s) => s.file);
  if (users.length) problems.push({ ...c, users });
}

console.log(`pending migration files: ${pending.length}; names created only by pending files: ${pendingOnly.length ? pendingOnly.map((c) => c.name).join(", ") : "none"}`);
if (problems.length) {
  for (const p of problems) {
    console.log(`  FAIL  ${p.kind} "${p.name}" exists only in ${p.file} (not applied), but app code uses it: ${p.users.join(", ")}`);
  }
  console.log("\nApply the migration, move it into supabase/migrations/ under its recorded version, then ship the code.");
  console.log(`\n${problems.length} release blocker(s)`);
  process.exit(1);
}
console.log("  ok    no application code depends on an unapplied migration\n\n0 release blockers");
