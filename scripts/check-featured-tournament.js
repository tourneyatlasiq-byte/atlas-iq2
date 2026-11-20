/**
 * One featured-tournament rule and the device's own calendar date (2026-11).
 *
 * Home, the Tournaments Next tournament view and Locations & Resources must
 * pick the same tournament, and "today" must be the coach's date, not UTC.
 * Time zone behavior is checked by re-running the date assertions in child
 * processes with TZ set to zones on both sides of UTC.
 */
const path = require("path"), fs = require("fs"), Module = require("module");
const { execFileSync } = require("child_process");
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
const { localDateIso, utcDateIso, daysBetween } = require(path.join(ROOT, "lib", "local-date.js"));
const { featuredTournament, featuredLabel } = require(path.join(ROOT, "lib", "featured-tournament.js"));
const { defaultTrackerMode } = require(path.join(ROOT, "lib", "tracker-cursor.js"));
const { createEmphasis } = require(path.join(ROOT, "lib", "picker-rules.js"));
const { nextUpTournament } = require(path.join(ROOT, "lib", "readiness", "dashboard.js"));

const T = (id, name, start, end, extra = {}) => ({ id, name, start_date: start, end_date: end, decision: "Committed", paid_status: "Registered", ...extra });
const pick = (ts, today) => featuredTournament(ts, today)?.tournament?.name ?? null;

if (process.env.ST_TZ_CHILD) {
  // Child run: the process time zone is already set. Only the date rules here.
  const tz = process.env.TZ;
  const at = (iso, h, m = 0) => { const [y, mo, d] = iso.split("-").map(Number); return new Date(y, mo - 1, d, h, m, 0); }; // local wall clock
  console.log(`TZ ${tz}`);
  eq(`${tz}: 00:00:30 local is that local date`, localDateIso(at("2026-11-19", 0, 0)), "2026-11-19");
  eq(`${tz}: 23:59 local is still that local date`, localDateIso(at("2026-11-19", 23, 59)), "2026-11-19");
  eq(`${tz}: one minute after local midnight is the next date`, localDateIso(new Date(at("2026-11-19", 23, 59).getTime() + 60000)), "2026-11-20");
  eq(`${tz}: Tracker opens live for a game today at 8pm local`, defaultTrackerMode("2026-11-19", localDateIso(at("2026-11-19", 20))), "live");
  eq(`${tz}: Tracker opens live for a game today at 00:01 local`, defaultTrackerMode("2026-11-19", localDateIso(at("2026-11-19", 0, 1))), "live");
  eq(`${tz}: Tracker opens on Edit at-bats the next local day`, defaultTrackerMode("2026-11-19", localDateIso(at("2026-11-20", 0, 1))), "review");
  eq(`${tz}: a tournament ending today is still featured all day`, [pick([T("a", "Ends today", "2026-11-17", "2026-11-19")], localDateIso(at("2026-11-19", 23, 30)))], ["Ends today"]);
  eq(`${tz}: and gone the next local morning`, pick([T("a", "Ends today", "2026-11-17", "2026-11-19")], localDateIso(at("2026-11-20", 0, 5))), null);
  eq(`${tz}: Daylight saving cannot shift whole days`, [daysBetween("2026-03-07", "2026-03-09"), daysBetween("2026-11-01", "2026-11-02"), daysBetween("2026-10-31", "2026-11-02")], [2, 1, 2]);
  console.log(`${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

console.log("A. eligibility");
eq("Committed and registered is featured", pick([T("a", "Open", "2026-11-20", "2026-11-22")], "2026-11-19"), "Open");
eq("Declined is never featured", pick([T("a", "No", "2026-11-20", "2026-11-22", { decision: "Declined" })], "2026-11-19"), null);
eq("Considering is never featured", pick([T("a", "Maybe", "2026-11-20", "2026-11-22", { decision: "Considering" })], "2026-11-19"), null);
eq("Waitlisted is never featured", pick([T("a", "Wait", "2026-11-20", "2026-11-22", { paid_status: "Waitlisted" })], "2026-11-19"), null);
eq("a waitlisted event does not hide a later registered one", pick([T("a", "Wait", "2026-11-20", "2026-11-22", { paid_status: "Waitlisted" }), T("b", "Later", "2026-12-04", "2026-12-06")], "2026-11-19"), "Later");
eq("Not Registered (committed, not yet entered) is still featured", pick([T("a", "Todo", "2026-11-20", "2026-11-22", { paid_status: "Not Registered" })], "2026-11-19"), "Todo");
eq("no start date is never featured", pick([T("a", "Undated", null, null)], "2026-11-19"), null);
eq("nothing at all", featuredTournament([], "2026-11-19"), null);
eq("null list", featuredTournament(null, "2026-11-19"), null);

console.log("B. finished versus still on");
eq("a one day event today is featured", pick([T("a", "One day", "2026-11-19", null)], "2026-11-19"), "One day");
eq("a one day event yesterday is finished", pick([T("a", "One day", "2026-11-18", null)], "2026-11-19"), null);
eq("end before start is read as one day", pick([T("a", "Bad end", "2026-11-19", "2026-11-17")], "2026-11-19"), "Bad end");
eq("the last day still counts", pick([T("a", "Last day", "2026-11-17", "2026-11-19")], "2026-11-19"), "Last day");
eq("the day after the last day it is finished", pick([T("a", "Last day", "2026-11-17", "2026-11-19")], "2026-11-20"), null);

console.log("C. order");
eq("soonest start wins", pick([T("a", "Later", "2026-12-04", "2026-12-06"), T("b", "Sooner", "2026-11-27", "2026-11-29")], "2026-11-19"), "Sooner");
eq("in progress beats a later event", pick([T("a", "Later", "2026-11-20", "2026-11-22"), T("b", "Underway", "2026-11-18", "2026-11-21")], "2026-11-19"), "Underway");
eq("in progress beats one starting today", pick([T("a", "Starts today", "2026-11-19", "2026-11-21"), T("b", "Underway", "2026-11-17", "2026-11-20")], "2026-11-19"), "Underway");
eq("two in progress: the earlier start", pick([T("a", "B", "2026-11-18", "2026-11-21"), T("b", "A", "2026-11-17", "2026-11-23")], "2026-11-19"), "A");
eq("same start, earlier end first", pick([T("a", "Long", "2026-11-20", "2026-11-24"), T("b", "Short", "2026-11-20", "2026-11-21")], "2026-11-19"), "Short");
eq("same dates: name then id, never input order", [pick([T("2", "Beta", "2026-11-20", "2026-11-21"), T("1", "Alpha", "2026-11-20", "2026-11-21")], "2026-11-19"), pick([T("1", "Alpha", "2026-11-20", "2026-11-21"), T("2", "Beta", "2026-11-20", "2026-11-21")], "2026-11-19")], ["Alpha", "Alpha"]);
eq("identical name and dates: id decides", [featuredTournament([T("z", "Same", "2026-11-20", null), T("a", "Same", "2026-11-20", null)], "2026-11-19").tournament.id], ["a"]);

console.log("D. what it reports");
const f1 = featuredTournament([T("a", "Weekend", "2026-11-20", "2026-11-22")], "2026-11-19");
eq("tomorrow", [f1.daysAway, f1.state, featuredLabel(f1)], [1, "upcoming", "Tomorrow"]);
const f2 = featuredTournament([T("a", "Weekend", "2026-11-20", "2026-11-22")], "2026-11-20");
eq("first day is Today", [f2.daysAway, f2.state, f2.dayNumber, f2.totalDays, featuredLabel(f2)], [0, "today", 1, 3, "Today"]);
const f3 = featuredTournament([T("a", "Weekend", "2026-11-20", "2026-11-22")], "2026-11-21");
eq("second day is in progress, day 2 of 3", [f3.daysAway, f3.state, f3.dayNumber, featuredLabel(f3)], [0, "in_progress", 2, "In progress, day 2 of 3"]);
const f4 = featuredTournament([T("a", "Weekend", "2026-11-20", "2026-11-22")], "2026-11-22");
eq("last day is in progress, day 3 of 3", [f4.state, featuredLabel(f4)], ["in_progress", "In progress, day 3 of 3"]);
const f5 = featuredTournament([T("a", "Week", "2026-12-04", "2026-12-06")], "2026-11-19");
eq("later is counted in days", [f5.daysAway, featuredLabel(f5)], [15, "in 15 days"]);
const f6 = featuredTournament([T("a", "One day", "2026-11-19", null)], "2026-11-19");
eq("one day event today reads Today, day 1 of 1", [f6.state, f6.totalDays, featuredLabel(f6)], ["today", 1, "Today"]);

console.log("E. the server's first render uses the same rule");
const sample = [T("a", "Weekend", "2026-11-20", "2026-11-22"), T("b", "Wait", "2026-11-19", "2026-11-21", { paid_status: "Waitlisted" })];
eq("nextUpTournament is the shared rule on the UTC date", nextUpTournament(sample, new Date("2026-11-20T01:30:00Z")).tournament.name, "Weekend");
eq("nextUpTournament never features a waitlisted event", nextUpTournament([sample[1]], new Date("2026-11-19T15:00:00Z")), null);
eq("UTC date helper", utcDateIso(new Date("2026-11-20T01:30:00Z")), "2026-11-20");

console.log("F. Tracker tab default");
eq("game before today opens Edit at-bats", defaultTrackerMode("2026-11-18", "2026-11-19"), "review");
eq("game today opens live", defaultTrackerMode("2026-11-19", "2026-11-19"), "live");
eq("game later opens live", defaultTrackerMode("2026-11-20", "2026-11-19"), "live");
eq("game with no date opens live", defaultTrackerMode(null, "2026-11-19"), "live");

console.log("G. picker: matches first, add stays quiet while something can be picked");
eq("typed, matches exist: quiet", createEmphasis({ query: "riv", matchCount: 3, itemCount: 40 }), "quiet");
eq("typed, nothing matches: bright", createEmphasis({ query: "riv", matchCount: 0, itemCount: 40 }), "primary");
eq("nothing typed, directory has places: quiet", createEmphasis({ query: "", matchCount: 0, itemCount: 40 }), "quiet");
eq("empty directory: bright", createEmphasis({ query: "", matchCount: 0, itemCount: 0 }), "primary");
eq("spaces only count as nothing typed", createEmphasis({ query: "   ", matchCount: 0, itemCount: 5 }), "quiet");
eq("a skip button is never bright", createEmphasis({ query: "x", matchCount: 0, itemCount: 0, forceQuiet: true }), "quiet");

console.log("H. wiring (source checks)");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const dash = read("components/DashboardClient.js"), tour = read("components/TournamentClient.js"), trk = read("components/TrackerClient.js"), wk = read("components/WeekendCard.js"), pk = read("components/SearchPicker.js");
eq("Home features through the shared rule on the device date", /useLocalToday\(serverToday\)/.test(dash) && /featuredTournament\(tournaments, today\)/.test(dash), true);
eq("Tournaments next view features through the shared rule", /useLocalToday\(serverToday\)/.test(tour) && /featuredTournament\(tournaments, todayLocal\)/.test(tour), true);
eq("Home no longer shows the UTC date label once mounted", /longDayLabel\(today\)/.test(dash), true);
eq("Tracker default tab uses the device date after mount", /defaultTrackerMode\(game\.game_date, localDateIso\(\)\)/.test(trk), true);
eq("Tracker default tab first render matches the server", /defaultTrackerMode\(game\.game_date, serverToday \?\? utcDateIso\(\)\)/.test(trk), true);
eq("the future-score rule and recording logic still use their own date", /scoreAllowed = !game\.game_date \|\| game\.game_date <= new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(trk), true);
eq("WeekendCard shows day N of M when underway", /Day \{featured\.dayNumber\}/.test(wk), true);
eq("picker add button follows the emphasis rule", /createEmphasis\(/.test(pk) && /data-emphasis=/.test(pk), true);
eq("the clock is read only in the helper and the hook, not in the rule", !/new Date\(/.test(read("lib/featured-tournament.js").replace(/\/\*[\s\S]*?\*\//g, "")), true);

console.log("I. time zones on both sides of UTC (child runs)");
for (const tz of ["America/New_York", "America/Los_Angeles", "Pacific/Honolulu", "UTC", "Europe/London", "Asia/Kolkata", "Asia/Tokyo", "Pacific/Auckland", "Pacific/Kiritimati"]) {
  try {
    const out = execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, ST_TZ_CHILD: "1" }, encoding: "utf8" });
    const lines = out.trim().split("\n");
    const last = lines[lines.length - 1];
    const m = /^(\d+) assertions, (\d+) failed/.exec(last);
    eq(`${tz}: ${m ? m[1] : "?"} date assertions`, m ? Number(m[2]) : -1, 0);
  } catch (e) {
    failed++; console.log(`  FAIL  ${tz}\n${e.stdout ?? e.message}`);
  }
}
console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
