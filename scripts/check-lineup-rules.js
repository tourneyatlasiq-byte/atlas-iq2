// Pure checks for lib/lineup-rules.js (late arrival timing and wording).
const path = require("path");
const swc = require("next/dist/build/swc");
const fs = require("fs");
const Module = require("module");
const file = path.join(__dirname, "..", "lib", "lineup-rules.js");
const out = swc.transformSync(fs.readFileSync(file, "utf8"), { jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" }, filename: file }).code;
const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(out, file);
const { lateArrivalTiming, lateArrivalMessage } = m.exports;
let bad = 0;
const t = (name, cond) => { console.log(`${cond ? "ok  " : "FAIL"}  ${name}`); if (!cond) bad++; };
const order = (n) => [...Array(n)].map((_, i) => ({ batting_order: i + 1 }));
const pas = (slots) => slots.map((s, i) => ({ batting_order: s, created_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`, voided_at: null, pa_number: i + 1 }));
const cases = [[[1, 2, 3, 4], 5], [[1], 8], [[1, 2, 3, 4, 5, 6, 7, 8, 9], 0], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2], 7], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8], 1]];
for (const [seq, ahead] of cases) {
  const r = lateArrivalTiming(order(9), pas(seq));
  t(`last slot ${seq[seq.length - 1]} of 9 (${seq.length} at-bats): ${ahead} ahead`, r.ahead === ahead);
}
t("no at-bats: not tracked", lateArrivalTiming(order(9), []).tracked === false);
t("0 ahead says bats next", /bats next/.test(lateArrivalMessage(lateArrivalTiming(order(9), pas([1, 2, 3, 4, 5, 6, 7, 8, 9])), 1)));
t("message says late batters do not get past turns", /do not get the turns already taken/.test(lateArrivalMessage(lateArrivalTiming(order(9), pas([1, 2])), 1)));
process.exit(bad ? 1 : 0);
