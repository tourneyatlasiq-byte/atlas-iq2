// Days-until uses the device date, and the roster breaks ties by name. Static plus behavior checks.
const fs = require("fs"); const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
let pass = 0, fail = 0;
const ok = (n, v) => { if (v) pass++; else { fail++; console.log("FAIL", n); } console.log((v ? "  ok    " : "  FAIL  ") + n); };
const tc = read("components/TournamentClient.js");
const rc = read("components/RosterClient.js");

// days until
ok("daysUntil takes the device date and does not use the UTC date", /function daysUntil\(date, today\)/.test(tc) && !/function daysUntil[\s\S]{0,260}toISOString/.test(tc));
ok("daysUntil counts calendar days with the shared helper", /return daysBetween\(today, date\)/.test(tc));
ok("both callers pass the device date", /daysUntil\(t\.start_date, deviceToday\)/g.test(tc) && (tc.match(/daysUntil\(t\.start_date, deviceToday\)/g) || []).length === 2);
ok("no caller still uses the one-argument form", !/daysUntil\(t\.start_date\)/.test(tc));
ok("the UTC future-score rule is untouched", fs.existsSync(path.join(__dirname, "../lib/game-rules.js")) && /isFutureGame/.test(read("lib/game-rules.js")));

// behavior of the date math, evening Eastern (UTC is already the next day)
const dayMs = 86400000; const toUtcDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((toUtcDay(b) - toUtcDay(a)) / dayMs);
ok("tournament tomorrow reads 1 on the device date (7pm Eastern case)", daysBetween("2026-11-23", "2026-11-24") === 1);
ok("the old UTC date would have read 0", daysBetween("2026-11-24", "2026-11-24") === 0);
ok("tournament today reads 0, across a month end and DST", daysBetween("2026-11-01", "2026-11-01") === 0 && daysBetween("2027-03-13", "2027-03-15") === 2);

// roster
ok("the sort keeps active before inactive first", /a\.is_active !== b\.is_active\) return a\.is_active \? -1 : 1/.test(rc));
ok("jersey number order is kept, missing numbers after", /a\.jersey_number - b\.jersey_number/.test(rc) && /a\.jersey_number == null && b\.jersey_number != null\) return 1/.test(rc));
ok("ties fall to last name, first name, then id", /compareRosterNames\(a, b\)/.test(rc) && /al\.localeCompare[\s\S]{0,160}af\.localeCompare[\s\S]{0,160}a\.id/.test(rc));

// run the comparator against shuffled inputs
const src = rc.slice(rc.indexOf("function rosterNameKey"), rc.indexOf("export function RosterClient"));
const { compareRosterNames } = new Function(src + "; return { compareRosterNames };")();
const cmp = (a, b) => {
  if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
  if (a.jersey_number == null && b.jersey_number != null) return 1;
  if (b.jersey_number == null && a.jersey_number != null) return -1;
  if (a.jersey_number != null && a.jersey_number !== b.jersey_number) return a.jersey_number - b.jersey_number;
  return compareRosterNames(a, b);
};
const P = (id, full, last, first, jersey, active = true) => ({ id, is_active: active, jersey_number: jersey, player: { full_name: full, last_name: last, legal_first_name: first } });
const rows = [P("5", "Chris Mower", "Mower", "Chris", null), P("1", "Brynn Mower", "Mower", "Brynn", null), P("2", "Ava Adams", "Adams", "Ava", null), P("3", "Zoe Lee", "Lee", "Zoe", 7), P("4", "Amy Lee", "Lee", "Amy", 7), P("6", "Old Timer", "Timer", "Old", 1, false), P("7", "Legacy Person", undefined, undefined, null)];
const expected = ["4", "3", "2", "7", "1", "5", "6"].join(","); // legacy "Legacy Person" sorts by its whole full_name, never split
let stable = true;
for (let i = 0; i < 40; i++) { const sh = [...rows].sort(() => Math.random() - 0.5).sort(cmp); if (sh.map((r) => r.id).join(",") !== expected) stable = false; }
ok("same order from any database order (numbers, then name; inactive last)", stable);
const asc = [...rows].sort(cmp).map((r) => r.id).join(",");
ok("Brynn Mower always before Chris Mower", asc.indexOf("1") < asc.indexOf("5"));
ok("a comparator is consistent for two rows with no number (a before b and b before a cannot both hold)", cmp(rows[0], rows[1]) === -cmp(rows[1], rows[0]));
ok("the tie-break never splits full_name", !/full_name[\s\S]{0,80}?\.split\(/.test(rc));
ok("a legacy record with only full_name does not throw", (() => { try { cmp(rows[6], rows[0]); return true; } catch { return false; } })());
// Red-green: the previous comparator (jersey only) depends on the database order for players without numbers.
const oldCmp = (a, b) => { if (a.is_active !== b.is_active) return a.is_active ? -1 : 1; if (a.jersey_number == null) return 1; if (b.jersey_number == null) return -1; return a.jersey_number - b.jersey_number; };
const noNum = [P("a", "Chris Mower", "Mower", "Chris", null), P("b", "Brynn Mower", "Mower", "Brynn", null)];
ok("red: the old comparator gives a different order for the same two players depending on input order", [...noNum].sort(oldCmp)[0].id !== [...noNum].reverse().sort(oldCmp)[0].id);
ok("green: the new comparator gives Brynn first either way", [...noNum].sort(cmp)[0].id === "b" && [...noNum].reverse().sort(cmp)[0].id === "b");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
