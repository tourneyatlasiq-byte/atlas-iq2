/**
 * Tournament status list, quick actions, and the Mark paid in full / Undo
 * wiring.
 *
 * Offline checks only: the shared status helpers are exercised directly, and
 * the server actions are checked at source level (parameter names must match
 * the SQL function signature, Undo must be guarded). Database behaviour is
 * proven separately by scripts/test-mark-paid-local.sh.
 *
 * Run:  node scripts/check-tournament-status.js
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const swc = require("next/dist/build/swc");
// The app's modules use extensionless ESM imports; compile them the way Next does.
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(module, filename);
  const { code } = swc.transformSync(fs.readFileSync(filename, "utf8"), {
    jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" }, filename,
  });
  module._compile(code, filename);
};
const load = async (f) => require(path.resolve(f));

let passed = 0;
const failures = [];
function ok(name, cond) {
  if (cond) { passed += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}`); }
}
function section(t) { console.log(`\n${t}\n`); }
const read = (f) => fs.readFileSync(f, "utf8");

(async () => {
const S = await load("lib/tournament-status.js");

section("One status list");
ok("payment statuses are the five the database allows",
  JSON.stringify(S.PAID_STATUSES) === JSON.stringify(["Not Registered", "Waitlisted", "Registered", "Deposit Paid", "Paid in Full"]));
ok("decisions are the three the database allows",
  JSON.stringify(S.DECISIONS) === JSON.stringify(["Considering", "Committed", "Declined"]));
ok("Waitlisted is not treated as registered", !S.isRegistered("Waitlisted") && S.isWaitlisted("Waitlisted"));
ok("Registered, Deposit Paid, Paid in Full count as registered",
  S.isRegistered("Registered") && S.isRegistered("Deposit Paid") && S.isRegistered("Paid in Full"));
ok("Mark paid in full is offered only from Registered or Deposit Paid",
  S.canMarkPaidInFull("Registered") && S.canMarkPaidInFull("Deposit Paid")
  && !S.canMarkPaidInFull("Not Registered") && !S.canMarkPaidInFull("Waitlisted") && !S.canMarkPaidInFull("Paid in Full"));
ok("validators reject unknown values and null",
  S.isValidPaidStatus("Paid in Full") && !S.isValidPaidStatus("Paid") && !S.isValidPaidStatus(null)
  && S.isValidDecision("Declined") && !S.isValidDecision("Maybe"));

section("Quick action: one next step per tournament");
const today = "2026-11-19";
const qa = (t) => S.quickAction(t, today)?.kind ?? null;
ok("Considering offers Commit", qa({ decision: "Considering", paid_status: "Not Registered", start_date: "2026-12-01" }) === "commit");
ok("Committed and not registered offers Register", qa({ decision: "Committed", paid_status: "Not Registered", start_date: "2026-12-01" }) === "register");
ok("Waitlisted offers Register", qa({ decision: "Committed", paid_status: "Waitlisted", start_date: "2026-12-01" }) === "register");
ok("Registered offers Mark paid", qa({ decision: "Committed", paid_status: "Registered", start_date: "2026-12-01" }) === "paid");
ok("Deposit Paid offers Mark paid", qa({ decision: "Committed", paid_status: "Deposit Paid", start_date: "2026-12-01" }) === "paid");
ok("Paid in Full offers nothing", qa({ decision: "Committed", paid_status: "Paid in Full", start_date: "2026-12-01" }) === null);
ok("Declined offers nothing", qa({ decision: "Declined", paid_status: "Not Registered", start_date: "2026-12-01" }) === null);
ok("A past tournament offers nothing", qa({ decision: "Committed", paid_status: "Registered", start_date: "2026-10-01", end_date: "2026-10-03" }) === null);

section("Payment figures (must agree with the database tournament_money_state)");
{
  const t = { id: "t1", total_cost: 1000 };
  const tx = [
    { id: "a", tournament_id: "t1", is_income: false, status: "Paid", actual_amount: 250, txn_date: "2026-11-01", budget_item_id: "b1" },
    { id: "b", tournament_id: "t1", is_income: false, status: "To Pay", actual_amount: 300, txn_date: "2026-11-05", budget_item_id: "b1" },
    { id: "c", tournament_id: "t1", is_income: true, status: "Paid", actual_amount: 999, txn_date: "2026-11-02", budget_item_id: "b9" },
    { id: "d", tournament_id: "other", is_income: false, status: "Paid", actual_amount: 700, txn_date: "2026-11-03", budget_item_id: "b1" },
  ];
  const f = S.tournamentPayments(t, tx);
  ok("paid counts Paid expenses for this tournament only", f.paid === 250);
  ok("income and other tournaments never count", f.paid === 250 && f.toPay === 300);
  ok("remaining is cost minus paid", f.remaining === 750);
  ok("the unpaid entry is listed so Mark paid can settle it instead of duplicating it",
    f.toPayCount === 1 && f.toPayEntries.length === 1 && f.toPayEntries[0].id === "b" && f.toPayEntries[0].amount === 300);
  ok("remaining never goes below zero", S.tournamentPayments({ id: "t1", total_cost: 100 }, tx).remaining === 0);
  ok("no cost set gives no remaining figure", S.tournamentPayments({ id: "t1", total_cost: null }, tx).remaining === null);
  ok("localToday is a plain calendar date", /^\d{4}-\d{2}-\d{2}$/.test(S.localToday()));
}

section("Single source of truth");
const tc = read("components/TournamentClient.js");
const tq = read("lib/queries/tournaments.js");
ok("TournamentClient imports the shared lists", /from "\.\.\/lib\/tournament-status"/.test(tc));
ok("TournamentClient no longer defines its own lists", !/const (DECISIONS|PAID_STATUSES)\s*=/.test(tc));
ok("queries/tournaments no longer defines its own lists", !/const (DECISIONS|PAID_STATUSES)\s*=/.test(tq));

section("Server actions match the database function");
const ta = read("lib/actions/tournaments.js");
const fa = read("lib/actions/finance.js");
// The migration lives in supabase/pending/ until Autumn approves and applies it,
// then moves to supabase/migrations/<version>_mark_tournament_paid_in_full.sql.
const sqlPath = fs.existsSync("supabase/pending/mark_tournament_paid_in_full.sql")
  ? "supabase/pending/mark_tournament_paid_in_full.sql"
  : fs.readdirSync("supabase/migrations").map((f) => "supabase/migrations/" + f).find((f) => f.endsWith("_mark_tournament_paid_in_full.sql"));
const sql = read(sqlPath);
const params = ["p_tournament_id", "p_request_key", "p_expected_status", "p_expected_paid", "p_expected_to_pay_count",
  "p_record_payment", "p_to_pay_id", "p_amount", "p_date", "p_budget_item_id"];
ok("every parameter the action sends exists in the SQL function", params.every((p) => ta.includes(p + ":") && sql.includes(p)));
ok("the action sends nothing the SQL function does not declare",
  [...ta.matchAll(/\b(p_[a-z_]+):/g)].map((m) => m[1]).every((p) => sql.includes(p)));
ok("undo action passes p_operation_id", ta.includes("p_operation_id") && sql.includes("p_operation_id"));
ok("Mark paid action calls the atomic function", ta.includes('rpc("mark_tournament_paid_in_full"'));
{
  const code = sql.replace(/--.*$/gm, "");
  const fn = (name) => { const i = code.search(new RegExp(`create or replace function public\\.${name}\\(`)); if (i < 0) return ""; const j = code.indexOf("$$;", code.indexOf("$$", i) + 2); return code.slice(i, j); };
  const writers = ["mark_tournament_paid_in_full", "undo_mark_tournament_paid_in_full", "record_player_payment", "undo_player_payment"];
  const readers = ["tournament_money_state", "tournament_payment_fingerprint", "player_payment_fingerprint"];
  ok("the four payment writers run as definer, pin search_path and check the caller (season membership and write rights)",
    writers.every((w) => { const b = fn(w); return /security definer/i.test(b) && /set search_path = public, pg_temp/i.test(b) && /auth_organization_id\(\)/.test(b) && /auth_season_ids\(\)/.test(b) && /auth_can_write\(\)/.test(b); }));
  ok("the three read helpers stay security invoker", readers.every((r) => { const b = fn(r); return b && !/security definer/i.test(b); }));
  ok("operation tables give clients read-only access (no write policy, select-only grant)",
    !/create policy[^;]*on public\.(tournament|player)_payment_operations[^;]*for (insert|update|delete|all)/i.test(code)
    && /revoke all on public\.tournament_payment_operations from public, anon, authenticated/.test(code)
    && /grant select on public\.tournament_payment_operations to authenticated/.test(code)
    && /revoke all on public\.player_payment_operations from public, anon, authenticated/.test(code)
    && /grant select on public\.player_payment_operations to authenticated/.test(code));
  ok("Mark paid sends the live cost and unpaid entries to the database", /p_expected_cost/.test(ta) && /p_expected_to_pay/.test(ta) && /p_expected_cost/.test(sql) && /p_expected_to_pay/.test(sql));
}
ok("request keys are unique per organization, not global, for transactions", /budget_transactions \(organization_id, request_key\)/.test(sql));

section("Duplicate protection and Undo safeguards");
ok("saveTransaction handles a duplicate key by returning the first row", /23505/.test(fa) && /duplicate: true/.test(fa));
ok("recordPayment records through the atomic database function", fa.includes('rpc("record_player_payment"'));
ok("recordPayment sends the balance the screen showed and a request key", /p_expected_paid/.test(fa) && /p_request_key/.test(fa));
ok("recordPayment reports a changed balance with the live figures", /code: data\?\.code/.test(fa) && /entry_count/.test(fa));
ok("undoRecordedPayment goes through the locked database function", fa.includes('rpc("undo_player_payment"'));
ok("player payment parameters match the SQL signatures",
  ["p_payment_id", "p_request_key", "p_expected_paid", "p_amount", "p_date", "p_month_label", "p_operation_id"].every((p) => fa.includes(p + ":") && sql.includes(p)));
ok("setTournamentStatus supports compare-and-set (expected value)", /hasExpected/.test(ta) && /code: "changed"/.test(ta));
ok("setTournamentStatus returns the previous value for Undo", /return \{ ok: true, previous \}/.test(ta));
ok("undoNewTransaction deletes only when amount, status, date, line and description still match",
  ["actual_amount", "status", "txn_date", "budget_item_id", "item"].every((c) => new RegExp(`undoNewTransaction[\\s\\S]*\\.eq\\("${c}"`).test(fa)));
ok("player payment Undo sends only the operation id; eligibility is decided in the database",
  /undo_player_payment", \{ p_operation_id: operationId \}/.test(fa) && !/expected_entry_count|expected_amount/.test(fa.slice(fa.indexOf("undoRecordedPayment"), fa.indexOf("deletePaymentEntry"))) && /player_payment_fingerprint\(op\.payment_id\) is distinct from op\.after_fingerprint/.test(sql));
ok("undo database function compares a fingerprint before reversing", /after_fingerprint is distinct|fingerprint\(op\.tournament_id\) is distinct/.test(sql));

section("The pending-migration build guard covers database functions");
{
  const os = require("os");
  const { spawnSync } = require("child_process");
  const guard = path.resolve("scripts/check-pending-columns.js");
  const mk = (withMigration) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
    for (const x of ["supabase/pending", "supabase/migrations", "lib", "app", "components"]) fs.mkdirSync(path.join(d, x), { recursive: true });
    fs.writeFileSync(path.join(d, "supabase/pending/x.sql"), "create or replace function public.demo_atomic_fn() returns int language sql as $$ select 1 $$;");
    if (withMigration) fs.writeFileSync(path.join(d, "supabase/migrations/20260101000000_x.sql"), "create or replace function public.demo_atomic_fn() returns int language sql as $$ select 1 $$;");
    fs.writeFileSync(path.join(d, "lib/a.js"), 'export const f = (s) => s.rpc("demo_atomic_fn");');
    return d;
  };
  const blocked = spawnSync("node", [guard, mk(false)], { encoding: "utf8" });
  const allowed = spawnSync("node", [guard, mk(true)], { encoding: "utf8" });
  ok("code calling a function that exists only in supabase/pending/ fails the build", blocked.status === 1 && /function "demo_atomic_fn"/.test(blocked.stdout), blocked.stdout);
  ok("the same code passes once the function is in supabase/migrations/", allowed.status === 0, allowed.stdout);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("\nFailures:\n  " + failures.join("\n  ")); process.exit(1); }
})();
