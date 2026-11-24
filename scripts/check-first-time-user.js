/**
 * First-time-user improvements (2026-11): date rule, optional dues, "X of 4
 * completed", restore from Help, QAB request, phone fields, gentle details
 * prompt, and the three Finance past-due states.
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
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const dates = require(path.join(ROOT, "lib", "dates.js"));
const onb = require(path.join(ROOT, "lib", "onboarding.js"));

console.log("A. the one date rule");
const { dateRangeError, DATE_RANGE_MESSAGE } = dates;
eq("end before start is rejected with the message", dateRangeError("2026-11-07", "2026-11-05"), DATE_RANGE_MESSAGE);
eq("end equal to start is fine", dateRangeError("2026-11-07", "2026-11-07"), null);
eq("end after start is fine", dateRangeError("2026-11-06", "2026-11-08"), null);
eq("no end date is fine (one day)", [dateRangeError("2026-11-07", ""), dateRangeError("2026-11-07", null), dateRangeError("2026-11-07", undefined)], [null, null, null]);
eq("no start date is not this rule's job", dateRangeError("", "2026-11-08"), null);
eq("across a year end", dateRangeError("2026-12-30", "2027-01-02"), null);
eq("timestamps are compared by day", dateRangeError("2026-11-07T00:00:00", "2026-11-06T23:00:00"), DATE_RANGE_MESSAGE);
eq("message tells the coach what to do", /Change the end date, or leave it empty/.test(DATE_RANGE_MESSAGE), true);
const actions = read("lib/actions/tournaments.js");
eq("create AND edit both check on the server", (actions.match(/dateRangeError\(fields\.start_date, fields\.end_date\)/g) ?? []).length, 2);
eq("the form checks the same rule before sending", /dateRangeError\(formData\.get\("start_date"\), formData\.get\("end_date"\)\)/.test(read("components/TournamentClient.js")), true);

console.log("B. setup steps: four counted, dues optional");
const mk = (o = {}) => onb.gettingStartedSteps({ teamNamed: true, seasonNamed: true, rosterCount: 0, tournamentCount: 0, duesCount: 0, teamName: "T", seasonName: "S", ...o });
eq("four steps", mk().length, 4);
eq("only dues is optional", mk().filter((s) => s.optional).map((s) => s.id), ["dues"]);
eq("required done, dues skipped: setup is complete", onb.setupComplete(mk({ rosterCount: 3, tournamentCount: 1 })), true);
eq("a required step missing: not complete", onb.setupComplete(mk({ rosterCount: 3 })), false);
eq("dues alone does not complete setup", onb.setupComplete(mk({ duesCount: 5 })), false);
eq("next step skips the optional one", onb.nextStep(mk({ rosterCount: 3, tournamentCount: 1 })), null);
eq("next step is the first required one left", onb.nextStep(mk({ rosterCount: 3 }))?.id, "tournament");
eq("one wording for the count", onb.completedLabel(2, 4), "2 of 4 completed");
eq("no new Premium language in the pitch", /premium|\$|price/i.test(onb.QAB_PITCH), false);
eq("the approved sentence", onb.QAB_PITCH, "Track quality at-bats from your phone and review results by player, game and tournament. Available on request during early access.");
eq("website address and subject", onb.QAB_REQUEST_HREF, "mailto:support@seasontempo.com?subject=Quality%20at-bat%20tracking%20request");
eq("button label", onb.QAB_REQUEST_LABEL, "Request QAB access");
eq("the count lives in one place on every screen", [/completedLabel\(done, steps\.length\)/.test(read("components/GettingStarted.js")), /completedLabel\(doneCount, steps\.length\)/.test(read("components/SetupNext.js")), /completedLabel\(progress\.done, progress\.total\)/.test(read("components/HelpCenter.js"))], [true, true, true]);

console.log("C. restore from Help");
const act = read("lib/actions/onboarding.js");
eq("show and hide share one write, scoped to the caller", /showGettingStarted\(\) \{\s*return setHidden\(false\)/.test(act) && /hideGettingStarted\(\) \{\s*return setHidden\(true\)/.test(act) && /onboarding_hidden: hidden[\s\S]*\.eq\("id", ctx\.profile\.id\)/.test(act) && (act.match(/\.from\("profiles"\)/g) ?? []).length === 1, true);
eq("Help offers the restore only when hidden", /ChecklistRestore hidden=\{Boolean\(progress\?\.hidden\)\}/.test(read("components/HelpCenter.js")), true);

console.log("D. Performance and checklist request");
const perf = read("app/(app)/performance/page.js");
eq("Performance uses the shared request", /QAB_PITCH/.test(perf) && /QAB_REQUEST_HREF/.test(perf) && !/not enabled for your organization/.test(perf), true);
eq("the QAB row is outside the counted steps", onb.gettingStartedSteps({}).some((s) => /qab/i.test(s.id)), false);

console.log("E. phone fields accept international numbers");
const roster = read("components/RosterClient.js");
const phones = roster.match(/<input[^>]*name="(?:player_phone|contact_phone)"[^>]*>/g) ?? [];
eq("three roster phone fields", phones.length, 3);
eq("each is type tel with a phone keypad and autofill", phones.every((p) => /type="tel"/.test(p) && /inputMode="tel"/.test(p) && /autoComplete="tel"/.test(p)), true);
eq("none restricts the format", phones.some((p) => /pattern=|maxLength|minLength/.test(p)), false);

console.log("F. Finance: three different empty states");
const fin = read("components/FinanceClient.js");
eq("no dues at all", /txt = "No dues set yet"/.test(fin) && /Set player dues/.test(fin), true);
eq("dues but no schedules", /txt = "No payment schedules yet"/.test(fin), true);
eq("genuinely nothing past due", /Every scheduled player is current/.test(fin), true);

console.log("G. details prompt is gentle");
const teamR = require(path.join(ROOT, "lib", "readiness", "team.js"));
eq("Team wording is a suggestion, not a warning", teamR.teamActionText({ id: "registration", affected: [{ id: "1", player: { full_name: "Riley Hart" } }] }), "Riley Hart could use a date of birth");
eq("Team labels the date-of-birth prompt as completing details", /Complete player details/.test(roster), true);
eq("Home does not paint it urgent", /id === "team:registration" \? "dot-planning"/.test(read("components/DashboardClient.js")), true);

console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
