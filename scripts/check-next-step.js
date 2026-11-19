/**
 * The tournament drawer's one volt button: the next useful action (2026-11).
 *
 * Rules, in priority order, for someone who can edit:
 *   Declined, or the event is over            nothing
 *   Considering                               Commit (nothing about registration or payment)
 *   Committed, during the event               Add game
 *   Committed, Waitlisted                     nothing (no place yet: no registration, payment, roster or games to chase)
 *   Committed, Not Registered                 Mark registered (a status record, never called "Register")
 *   Registered or Deposit Paid, money owed    Mark paid in full (only when a cost or an unpaid entry exists)
 *   a place held, roster empty, starts in 14 days or less   Set roster
 *   otherwise                                 nothing
 * Read-only users never get a next step.
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
let mod;
try { mod = require(path.join(ROOT, "lib", "tournament-next-step.js")); } catch (e) { eq("lib/tournament-next-step.js loads", String(e.message).split("\n")[0], "loads"); process.exit(1); }
const { nextStep } = mod;
const TODAY = "2026-11-19";
const base = { id: "t1", decision: "Committed", paid_status: "Registered", start_date: "2026-11-27", end_date: "2026-11-29", total_cost: 450 };
const ctx = (o = {}) => ({ canWrite: true, today: TODAY, rosterCount: 0, payments: { remaining: 450, toPayCount: 0 }, ...o });
const kind = (t, c) => nextStep({ ...base, ...t }, ctx(c))?.kind ?? null;
const label = (t, c) => nextStep({ ...base, ...t }, ctx(c))?.label ?? null;

console.log("A. who gets nothing");
eq("read-only user", kind({}, { canWrite: false }), null);
eq("Declined", kind({ decision: "Declined", paid_status: "Not Registered" }), null);
eq("finished tournament", kind({ start_date: "2026-11-01", end_date: "2026-11-03" }), null);
eq("Waitlisted: no payment prompt", kind({ paid_status: "Waitlisted" }), null);
eq("Waitlisted: no registration prompt either", label({ paid_status: "Waitlisted" }), null);
eq("Waitlisted during the event: still nothing", kind({ paid_status: "Waitlisted", start_date: "2026-11-19", end_date: "2026-11-21" }), null);

console.log("B. Considering only offers the decision");
eq("Considering, not registered: Commit, not registration", [kind({ decision: "Considering", paid_status: "Not Registered" }), label({ decision: "Considering", paid_status: "Not Registered" })], ["commit", "Commit"]);
eq("Considering with a registered status still only offers Commit", kind({ decision: "Considering", paid_status: "Registered" }), "commit");

console.log("C. Committed, in priority order");
eq("Not Registered: Mark registered (a status record)", [kind({ paid_status: "Not Registered" }), label({ paid_status: "Not Registered" })], ["register", "Mark registered"]);
eq("the word Register alone is never used", /^Register$/.test(label({ paid_status: "Not Registered" })), false);
eq("Registered with money owed: Mark paid in full", kind({}), "paid");
eq("Deposit Paid with money owed: Mark paid in full", kind({ paid_status: "Deposit Paid" }), "paid");
eq("Registered, no cost and nothing unpaid, roster empty, soon: Set roster", kind({ total_cost: null }, { payments: { remaining: null, toPayCount: 0 } }), "roster");
eq("an unpaid entry alone still counts as owed", kind({ total_cost: null }, { payments: { remaining: null, toPayCount: 1 } }), "paid");
eq("Paid in Full, roster empty, within 14 days: Set roster", kind({ paid_status: "Paid in Full" }, { payments: { remaining: 0, toPayCount: 0 } }), "roster");
eq("Paid in Full, roster empty, starts in exactly 14 days: Set roster", kind({ paid_status: "Paid in Full", start_date: "2026-12-03", end_date: "2026-12-05" }, { payments: { remaining: 0, toPayCount: 0 } }), "roster");
eq("Paid in Full, roster empty, 15 days out: nothing yet", kind({ paid_status: "Paid in Full", start_date: "2026-12-04", end_date: "2026-12-06" }, { payments: { remaining: 0, toPayCount: 0 } }), null);
eq("roster already set: nothing", kind({ paid_status: "Paid in Full" }, { rosterCount: 14, payments: { remaining: 0, toPayCount: 0 } }), null);
eq("Not Registered outranks a missing roster", kind({ paid_status: "Not Registered", start_date: "2026-11-21", end_date: "2026-11-22" }), "register");

console.log("D. during the event");
const during = { start_date: "2026-11-18", end_date: "2026-11-20" };
eq("Committed and registered, during: Add game (even with money owed)", kind(during), "game");
eq("the last day of the event still counts as during", kind({ start_date: "2026-11-17", end_date: "2026-11-19" }), "game");
eq("a one-day event today", kind({ start_date: "2026-11-19", end_date: "2026-11-19" }), "game");
eq("Considering during the event is still just Commit", kind({ ...during, decision: "Considering" }), "commit");
eq("Declined during the event: nothing", kind({ ...during, decision: "Declined" }), null);
eq("no end date: start date is the whole event", kind({ start_date: "2026-11-19", end_date: null }), "game");

console.log("E. the result carries what the screen needs");
const r = nextStep({ ...base, paid_status: "Not Registered" }, ctx());
eq("shape", Object.keys(r).sort(), ["kind", "label"]);
console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
