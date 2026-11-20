/** Performance: inactive players grouped beneath active ones, nothing else changes (2026-11). */
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
const { splitByActivity, activityByPlayer } = require(path.join(ROOT, "lib", "performance-groups.js"));

const sorted = [
  { playerId: "1", name: "Top", pa: 20, qab: 12, isActive: false },
  { playerId: "2", name: "Mid", pa: 10, qab: 5, isActive: true },
  { playerId: "3", name: "Pickup", pa: 4, qab: 1, isActive: true },
  { playerId: "4", name: "Low", pa: 8, qab: 1, isActive: false },
];
const g = splitByActivity(sorted);
eq("active players first, in the caller's order", g.active.map((p) => p.playerId), ["2", "3"]);
eq("inactive players grouped separately, in the caller's order", g.inactive.map((p) => p.playerId), ["1", "4"]);
eq("every player is in exactly one group", g.active.length + g.inactive.length, sorted.length);
eq("an inactive player with the best QAB% still lists beneath active ones", g.inactive[0].name, "Top");
eq("statistics are untouched", [...g.active, ...g.inactive].reduce((s, p) => s + p.pa, 0), 42);
eq("a row with no flag (older data) is treated as active", splitByActivity([{ playerId: "x" }]).active.length, 1);
eq("empty input", splitByActivity(undefined), { active: [], inactive: [] });

// Activity follows the team being viewed, never "any team".
const rows = [
  { player_id: "a", team_id: "T1", is_active: true }, { player_id: "b", team_id: "T1", is_active: false },
  { player_id: "c", team_id: "T1", is_active: false }, { player_id: "c", team_id: "T2", is_active: true }, // inactive on T1, active on T2
  { player_id: "d", team_id: "T2", is_active: true }, // only on another team
];
const m = activityByPlayer(rows, "T1");
eq("player inactive on the viewed team stays inactive even if active on another", [m.get("a"), m.get("b"), m.get("c")], [true, false, false]);
eq("a player with rows only on another team is unknown here, not active", m.has("d"), false);
const m2 = activityByPlayer(rows, "T2");
eq("viewing the other team reverses it", [m2.get("c"), m2.get("d"), m2.has("a")], [true, true, false]);
eq("no season row (pickup) is unknown, not inactive", m.has("z"), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
