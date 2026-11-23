/**
 * Locations Surface options (2026-11).
 * BEHAVIOURAL for the option builders and import; SOURCE checks for wiring.
 *
 * Rules under test (Autumn, 2026-11-22):
 *   - new selections are exactly All Turf, Dirt / Grass, Turf / Grass, in that order;
 *   - existing saved values keep displaying and stay editable, and opening a
 *     record then saving cannot change its surface (its own value is offered);
 *   - nothing is reclassified: the migration only widens the allowed list.
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const f = require(path.join(ROOT, "lib", "facility-fields.js"));
const imp = require(path.join(ROOT, "lib", "facility-import.js"));

console.log("Surface options");
assertEq("choices are exactly the three, in Autumn's order", f.SURFACE_CHOICES, ["All Turf", "Dirt / Grass", "Turf / Grass"]);
assertEq("suggest-a-change offers the same three", f.SURFACE_OPTIONS, f.SURFACE_CHOICES);
assertEq("a new or blank record is offered only the three", f.surfaceOptionsFor(null), ["All Turf", "Dirt / Grass", "Turf / Grass"]);
for (const legacy of ["Grass", "Turf", "Mixed"]) {
  assertEq(`an existing ${legacy} record still offers ${legacy}, after the three`, f.surfaceOptionsFor(legacy), [...f.SURFACE_CHOICES, legacy]);
}
assertEq("Unknown is not offered as an extra (blank Not specified covers it)", f.surfaceOptionsFor("Unknown"), f.SURFACE_CHOICES);
assertEq("a record already on a new value does not duplicate it", f.surfaceOptionsFor("Dirt / Grass"), f.SURFACE_CHOICES);

console.log("Round trip: open then save never changes the stored value");
for (const v of ["Grass", "Turf", "Mixed", "All Turf", "Dirt / Grass", "Turf / Grass"]) {
  assertEq(`${v}: its own value is among the options`, f.surfaceOptionsFor(v).includes(v), true);
}

console.log("Display");
for (const v of ["Grass", "Turf", "All Turf", "Dirt / Grass", "Turf / Grass"]) assertEq(`${v} displays`, f.displayableSurface(v), v);
for (const v of ["Mixed", "Unknown", null, ""]) assertEq(`${JSON.stringify(v)} stays hidden as before`, f.displayableSurface(v), null);

console.log("Filter");
const data = [{ surface_type: "Grass" }, { surface_type: "Grass" }, { surface_type: "Mixed" }, { surface_type: null }, { surface_type: "Unknown" }];
assertEq("three choices first, then older values present, then Unknown", f.surfaceFilterOptions(data), ["All Turf", "Dirt / Grass", "Turf / Grass", "Grass", "Mixed", "Unknown"]);
assertEq("an older value with no records is not listed", f.surfaceFilterOptions([{ surface_type: "Turf / Grass" }]), ["All Turf", "Dirt / Grass", "Turf / Grass", "Unknown"]);

console.log("Import");
const IMPORT_CASES = { "all turf": "All Turf", "ALL-TURF": "All Turf", "dirt/grass": "Dirt / Grass", "Dirt / Grass": "Dirt / Grass", "turf grass": "Turf / Grass", "Turf/Grass": "Turf / Grass", Grass: "Grass", turf: "Turf", Mixed: "Mixed", unknown: "Unknown" };
for (const [input, expected] of Object.entries(IMPORT_CASES)) assertEq(`import "${input}"`, f.normalizeSurface(input), expected);
assertEq("an unrecognised label is not guessed", f.normalizeSurface("Astro"), null);
const csv = ["Facility Name,Surface", "Park A,Dirt / Grass", "Park B,Astro", "Park C,"].join("\n");
const parsed = imp.rowsFromCsv(csv);
const surfaceOf = (n) => { const r = parsed.rows.find((x) => (x.data?.name ?? x.name) === n); return (r?.data ?? r)?.surface_type ?? null; };
assertEq("CSV: Dirt / Grass imports as is", surfaceOf("Park A"), "Dirt / Grass");
assertEq("CSV: an unrecognised label becomes Unknown (existing warning kept)", surfaceOf("Park B"), "Unknown");
assertEq("CSV: a blank surface stays blank", surfaceOf("Park C"), null);

console.log("Wiring and migration");
const ui = fs.readFileSync(path.join(ROOT, "components", "FacilitiesClient.js"), "utf8");
assertEq("form uses surfaceOptionsFor from the shared module", /surfaceOptionsFor\(row\?\.surface_type\)/.test(ui), true);
assertEq("filter uses surfaceFilterOptions", /surfaceFilterOptions\(facilities\)/.test(ui), true);
assertEq("the old local Grass/Turf/Unknown selection lists are gone", /SELECTABLE_SURFACES|const SURFACES =/.test(ui), false);
const sql = fs.readFileSync(path.join(ROOT, "supabase", "pending", "surface_options.sql"), "utf8").replace(/--.*$/gm, "");
for (const v of f.SURFACE_VALUES) assertEq(`migration allows ${v}`, sql.includes(`'${v}'`), true);
assertEq("migration updates no rows", /\b(update|delete|insert)\b/i.test(sql.replace(/comment on[\s\S]*?;/i, "")), false);
assertEq("migration keeps NULL valid", /surface_type is null/.test(sql), true);
assertEq("migration adds no column, table or function (so the pending-column guard stays quiet)", /add\s+column|create\s+(table|function)/i.test(sql), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
