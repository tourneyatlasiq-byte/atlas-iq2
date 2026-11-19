/**
 * Tournament dates read correctly for any length (2026-11): one day, a weekend,
 * midweek, a full week, across a month and across a new year, and bad data never
 * shows a backwards range. One helper (lib/dates.js) serves Home, Tournaments,
 * the season strip, the next-tournament card and Performance.
 */
const path = require("path"), fs = require("fs"), Module = require("module");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const { fmtDateRange, fmtDayRange, daySpan } = require(path.join(ROOT, "lib", "dates.js"));

console.log("A. date ranges");
eq("one day (no end)", fmtDateRange("2026-11-07", null), "Nov 7");
eq("one day (end equals start)", fmtDateRange("2026-11-07", "2026-11-07"), "Nov 7");
eq("weekend", fmtDateRange("2026-11-06", "2026-11-08"), "Nov 6 to 8");
eq("full week", fmtDateRange("2026-07-06", "2026-07-12"), "Jul 6 to 12");
eq("week across a month end", fmtDateRange("2026-06-28", "2026-07-04"), "Jun 28 to Jul 4");
eq("across a new year shows both years", fmtDateRange("2026-12-29", "2027-01-04"), "Dec 29, 2026 to Jan 4, 2027");
eq("end before start shows the start only", fmtDateRange("2026-11-07", "2026-11-05"), "Nov 7");
eq("no start", fmtDateRange(null, null), "Date not set");
eq("no start with a custom empty", fmtDateRange(null, null, { empty: "—" }), "—");
eq("timestamps are tolerated", fmtDateRange("2026-11-06T00:00:00", "2026-11-08T00:00:00"), "Nov 6 to 8");

console.log("B. day names and length");
eq("one day", fmtDayRange("2026-11-07", null), "Sat");
eq("weekend", fmtDayRange("2026-11-06", "2026-11-08"), "Fri to Sun");
eq("three days stays short", fmtDayRange("2026-11-06", "2026-11-08"), "Fri to Sun");
eq("full week says how many days", fmtDayRange("2026-07-06", "2026-07-12"), "Mon to Sun · 7 days");
eq("daySpan counts both ends", [daySpan("2026-07-06", "2026-07-12"), daySpan("2026-11-07", null), daySpan("2026-11-07", "2026-11-05"), daySpan(null, null)], [7, 1, 1, 0]);

console.log("C. no screen keeps its own copy of the formatter");
for (const f of ["components/WeekendCard.js", "components/SeasonStrip.js", "components/TournamentClient.js", "app/(app)/performance/page.js"]) {
  const s = fs.readFileSync(path.join(ROOT, f), "utf8");
  eq(`${f} uses lib/dates`, /lib\/dates"/.test(s) && !/\$\{f\(x\)\} to|\} to \$\{Number\(de\)\}|\$\{mon\(start\)\} day/.test(s), true);
}
console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
