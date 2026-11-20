/**
 * Attendance sheet selection (2026-11): who is listed, who starts selected, and what is submitted.
 * Rule: someone already attending stays visible and selected whether or not they are an active
 * player today; saving never drops an attendee the coach did not uncheck. Players who are not
 * attending start unselected.
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
const { rosterSheetModel, submissionEntries } = require(path.join(ROOT, "lib", "event-roster-selection.js"));

const seasonRoster = [
  { is_active: true, jersey_number: 1, positions: ["P"], player: { id: "a", full_name: "Ann", person_type: "player" } },
  { is_active: true, jersey_number: 2, positions: [], player: { id: "b", full_name: "Bea", person_type: "player" } },
  { is_active: false, jersey_number: 3, positions: ["SS"], player: { id: "c", full_name: "Cy", person_type: "player" } },
  { is_active: false, jersey_number: 4, positions: [], player: { id: "d", full_name: "Di", person_type: "player" } },
  { is_active: true, jersey_number: null, positions: [], player: { id: "coach", full_name: "Coach", person_type: "coach" } },
];
const participants = [
  { player_id: "a", participation: "roster", jersey_number: 11, positions: ["P"], player: { id: "a", full_name: "Ann" } },
  { player_id: "c", participation: "roster", jersey_number: null, positions: null, player: { id: "c", full_name: "Cy" } },
  { player_id: "z", participation: "roster", jersey_number: 9, positions: ["C"], player: { id: "z", full_name: "Zed (removed from season)" } },
  { player_id: "p", participation: "pickup", jersey_number: 23, positions: null, player: { id: "p", full_name: "Pat" } },
];

console.log("\nrosterSheetModel");
const m = rosterSheetModel(participants, seasonRoster);
eq("active players are the active, player-type rows", m.active.map((r) => r.player.id), ["a", "b"]);
eq("existing attendees who are not active stay listed, in roster order then unknowns", m.outside.map((o) => o.player_id), ["c", "z"]);
eq("an inactive attendee is labelled inactive; one off the season roster is labelled so", m.outside.map((o) => o.note), ["Inactive", "Not on this season's roster"]);
eq("names come from the roster row or the participant row", m.outside.map((o) => o.name), ["Cy", "Zed (removed from season)"]);
eq("pickups are not part of the sheet", m.outside.some((o) => o.player_id === "p"), false);
eq("initial selection is exactly who is already attending (active or not)", [...m.initialSelected].sort(), ["a", "c", "z"]);
eq("an inactive player who is NOT attending is not listed and not selected", [m.outside.some((o) => o.player_id === "d"), m.initialSelected.has("d")], [false, false]);
eq("with nobody attending, nothing starts selected", [...rosterSheetModel([], seasonRoster).initialSelected], []);

console.log("\nsubmissionEntries");
const keep = submissionEntries({ selected: new Set(["a", "b", "c", "z"]), model: m, participants });
eq("saving with an unrelated change keeps every attendee, inactive ones included", keep.map((e) => e.split("|")[0]), ["a", "b", "c", "z"]);
eq("an existing attendee keeps their event jersey and positions", keep.find((e) => e.startsWith("a|")), "a|roster|11|P");
eq("an attendee off the season roster keeps their stored values", keep.find((e) => e.startsWith("z|")), "z|roster|9|C");
eq("a new active attendee takes the season roster jersey and positions", submissionEntries({ selected: new Set(["b"]), model: m, participants }), ["b|roster|2|"]);
eq("unchecking an inactive attendee removes them (an explicit choice)", submissionEntries({ selected: new Set(["a"]), model: m, participants }).map((e) => e.split("|")[0]), ["a"]);

console.log("\nselect all active");
eq("Select all active players adds active players and keeps inactive attendees selected", [...m.selectAllActive(new Set(["c", "z"]))].sort(), ["a", "b", "c", "z"]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
