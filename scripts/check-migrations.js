/**
 * Migration directory integrity — OFFLINE.
 *
 * Deliberately requires no network access and no production credentials, so it
 * can run in `npm run check` on any machine and in CI. Reconciling these files
 * against the live database needs database access and is a separate, explicit
 * audit.
 *
 * Run:  node scripts/check-migrations.js
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "supabase", "migrations");
let ran = 0, failures = 0;

function ok(label, actual, expected) {
  ran += 1;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
  } else console.log(`  ok    ${label}`);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

console.log("\nMigration directory\n");

ok("every migration is named <version>_<name>.sql",
  files.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f)), []);

const versions = files.map((f) => f.slice(0, 14));

ok("no duplicate versions",
  versions.filter((v, i) => versions.indexOf(v) !== i), []);

// The failure that actually reached main: the six recovered migrations were
// extracted alongside their old-timestamp copies, so each existed twice under
// two different versions. Distinct versions meant the check above passed, and
// the directory misrepresented production while appearing healthy.
const names = files.map((f) => f.slice(15));
ok("no migration name appears at two versions",
  [...new Set(names.filter((n, i) => names.indexOf(n) !== i))].sort(), []);

ok("files sort in version order",
  versions.slice().sort().join() === versions.join(), true);

ok("no empty migration",
  files.filter((f) => fs.readFileSync(path.join(DIR, f), "utf8").trim() === ""), []);

// A stray timestamp that does not correspond to an applied migration is how
// the previous drift began: files whose versions Supabase had never recorded.
ok("every version is a plausible timestamp",
  versions.filter((v) => {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8);
    const h = +v.slice(8, 10), mi = +v.slice(10, 12), s = +v.slice(12, 14);
    return !(y >= 2020 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31
             && h < 24 && mi < 60 && s < 60);
  }), []);

ok("the provenance README is present",
  fs.existsSync(path.join(DIR, "README.md")), true);

// Recorded at recovery. A change here is not necessarily wrong — new
// migrations are expected — but it should be a deliberate commit, not a
// surprise.
const RECOVERED_AT_BASELINE = 95;
if (files.length !== RECOVERED_AT_BASELINE) {
  console.log(`  note  ${files.length} migrations (${RECOVERED_AT_BASELINE} at baseline; `
    + `${files.length - RECOVERED_AT_BASELINE} added since)`);
} else {
  ok("95 migrations, matching the recovered baseline", files.length, 95);
}

console.log(`\n${ran} assertions, ${failures} failed`);
process.exit(failures ? 1 : 0);
