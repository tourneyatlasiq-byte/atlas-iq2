/* Payment outstanding: flagged only for a known unpaid amount. */
const path = require("path"), fs = require("fs"), Module = require("module");
const ROOT = path.resolve(__dirname, "..");
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const { tournamentActions } = require("../lib/readiness/tournaments");
let fail = 0;
const ok = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) fail++; };
const today = new Date("2026-11-20T12:00:00");
const base = { id: "t1", decision: "Committed", paid_status: "Registered", start_date: "2026-11-27", end_date: "2026-11-29" };
const pay = (rows, tx = []) => tournamentActions(rows, today, tx).some((a) => a.id === "payment");
ok("no cost entered and no Finance entry: not flagged", !pay([{ ...base, total_cost: null }]));
ok("zero cost: not flagged", !pay([{ ...base, total_cost: 0 }]));
ok("known cost above paid: flagged", pay([{ ...base, total_cost: 500 }]));
ok("deposit paid leaves a balance: flagged", pay([{ ...base, paid_status: "Deposit Paid", total_cost: 500 }], [{ tournament_id: "t1", is_income: false, status: "Paid", actual_amount: 200 }]));
ok("cost fully covered by Paid entries: not flagged", !pay([{ ...base, total_cost: 500 }], [{ tournament_id: "t1", is_income: false, status: "Paid", actual_amount: 500 }]));
ok("linked To Pay entry with no cost entered: flagged", pay([{ ...base, total_cost: null }], [{ tournament_id: "t1", is_income: false, status: "To Pay", actual_amount: 300 }]));
ok("another tournament's To Pay entry does not count", !pay([{ ...base, total_cost: null }], [{ tournament_id: "t2", is_income: false, status: "To Pay", actual_amount: 300 }]));
ok("Paid in Full: not flagged", !pay([{ ...base, paid_status: "Paid in Full", total_cost: 500 }]));
ok("more than 30 days out: not flagged", !pay([{ ...base, start_date: "2027-02-01", total_cost: 500 }]));
process.exit(fail ? 1 : 0);
