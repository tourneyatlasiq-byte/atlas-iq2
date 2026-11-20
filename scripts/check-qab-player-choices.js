/**
 * Player choices for the individual QAB report (2026-11). Pure rules, no database.
 * Run: node scripts/check-qab-player-choices.js
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const { groupPlayerChoices, playerChoiceLabel, playerRosterStatus, filterPlayerChoices } = require(path.join(ROOT, "lib/qab-player-rules.js"));

let failed = 0, passed = 0;
function ok(label, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) passed++; else failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${pass ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const T = "team-1";
const row = (id, name, active, type = "player", team = T) => ({ player_id: id, team_id: team, is_active: active, player: { id, full_name: name, person_type: type } });
const pa = (id, name, n = 1) => Array.from({ length: n }, () => ({ player_id: id, player: { id, full_name: name } }));

console.log("\nIndividual player QAB report: who can be chosen\n");

const g = groupPlayerChoices({
  teamId: T,
  rosterRows: [row("b", "Bea", true), row("a", "Ava", true), row("i", "Ivy", false), row("z", "Zed", true), row("c", "Coach Cal", true, "coach"), row("o", "Other Team Kid", true, "player", "team-2")],
  paRows: [...pa("a", "Ava", 3), ...pa("i", "Ivy", 2), ...pa("p", "Pia Pickup", 4)],
});
ok("active players, A to Z, include one with no at-bats", g.active.map((c) => [c.name, c.pa]), [["Ava", 3], ["Bea", 0], ["Zed", 0]]);
ok("inactive players with history are offered", g.inactive.map((c) => [c.name, c.pa]), [["Ivy", 2]]);
ok("pickup players (at-bats, no roster row) are offered", g.pickup.map((c) => [c.name, c.pa]), [["Pia Pickup", 4]]);
ok("staff without at-bats are not offered", [...g.active, ...g.inactive, ...g.pickup].some((c) => c.name === "Coach Cal"), false);
ok("a player on another team only is not offered as roster", [...g.active, ...g.inactive].some((c) => c.name === "Other Team Kid"), false);

const g2 = groupPlayerChoices({ teamId: T, rosterRows: [row("a", "Ava", false), row("a", "Ava", true, "player", "team-2")], paRows: [] });
ok("a roster row on another team does not make an inactive player active", [g2.active.length, g2.inactive.length], [0, 1]);

const g3 = groupPlayerChoices({ teamId: T, rosterRows: [row("a", "Ava", true), row("a", "Ava", false)], paRows: [] });
ok("any active row on this team makes the player active, listed once", [g3.active.length, g3.inactive.length], [1, 0]);

const g4 = groupPlayerChoices({ teamId: T, rosterRows: [row("c", "Coach Cal", true, "coach")], paRows: pa("c", "Coach Cal", 2) });
ok("staff WITH recorded at-bats are offered", g4.active.map((c) => c.name), ["Coach Cal"]);

ok("same name, stable order by id", groupPlayerChoices({ teamId: T, rosterRows: [row("2", "Sam", true), row("1", "Sam", true)], paRows: [] }).active.map((c) => c.id), ["1", "2"]);
ok("empty inputs give three empty groups", groupPlayerChoices({}), { active: [], inactive: [], pickup: [] });

console.log("Choices agree with the report's own eligibility (every choice is a player the report accepts)");
for (const c of [...g.active, ...g.inactive, ...g.pickup]) {
  const status = playerRosterStatus([row("a", "Ava", true), row("i", "Ivy", false)].filter((r) => r.player_id === c.id), T, c.id);
  const group = g.active.includes(c) ? "active" : g.inactive.includes(c) ? "inactive" : "pickup";
  if (["a", "i", "p"].includes(c.id)) ok(`${c.name}: group matches report status`, status, group);
}

ok("label shows PA count", playerChoiceLabel({ name: "Ava", pa: 3 }), "Ava · 3 PA");
ok("label says no at-bats yet", playerChoiceLabel({ name: "Bea", pa: 0 }), "Bea · no at-bats yet");

console.log("Search");
const S = { active: [{ id: "1", name: "Ava Lane", pa: 3 }, { id: "2", name: "Zo\u00eb Park", pa: 0 }], inactive: [{ id: "3", name: "Ivy Lane", pa: 2 }], pickup: [{ id: "4", name: "Pia Pickup", pa: 1 }] };
const names = (r) => [...r.active, ...r.inactive, ...r.pickup].map((c) => c.name);
ok("empty or spaces returns everyone, groups kept", [names(filterPlayerChoices(S, "")), names(filterPlayerChoices(S, "   "))], [["Ava Lane", "Zo\u00eb Park", "Ivy Lane", "Pia Pickup"], ["Ava Lane", "Zo\u00eb Park", "Ivy Lane", "Pia Pickup"]]);
ok("matches anywhere in the name, ignoring case", names(filterPlayerChoices(S, "LANE")), ["Ava Lane", "Ivy Lane"]);
ok("a match keeps its group (inactive stays inactive)", [filterPlayerChoices(S, "lane").active.length, filterPlayerChoices(S, "lane").inactive.length, filterPlayerChoices(S, "pick").pickup.length], [1, 1, 1]);
ok("every word typed must match, in any order", names(filterPlayerChoices(S, "lane av")), ["Ava Lane"]);
ok("accents are ignored both ways", [names(filterPlayerChoices(S, "zoe")), names(filterPlayerChoices(S, "zo\u00eb"))], [["Zo\u00eb Park"], ["Zo\u00eb Park"]]);
ok("no match gives three empty groups", filterPlayerChoices(S, "xyz"), { active: [], inactive: [], pickup: [] });
ok("missing input is safe", filterPlayerChoices(undefined, "a"), { active: [], inactive: [], pickup: [] });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
