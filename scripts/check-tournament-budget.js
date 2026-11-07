/**
 * ST-015: the tournament drawer knows a tournament's budget line — BEHAVIOURAL.
 *
 * listSeasonTournaments never selected tournaments.budget_item_id, so the
 * drawer offered "Choose a budget line" for tournaments already linked, never
 * showed "$X used of $Y budget", and the Tournaments page computed budget-line
 * figures without the tournaments committed to them.
 *
 *   A. listSeasonTournaments, against an in-memory database that returns only
 *      the columns the query selects: budget_item_id arrives, nothing else new
 *   B. tournamentBudgetLines (the drawer's figures) equals Finance's own
 *      budget-line figures: larger-of commitments, ST-011 cross-line ownership
 *   C. TournamentDetail, rendered: no line → Choose; linked → Change, with
 *      the line's context; the ST-007 Review Tournament deep link opens Costs
 *   D. setTournamentBudgetLine: changing and clearing the line
 */

const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
let passed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}

let db = null;
let searchParams = new URLSearchParams();
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const CONTEXT = path.join(ROOT, "lib", "context.js");
const stubs = {
  "next/cache": { revalidatePath() {} },
  "next/headers": { cookies() { return { get() {}, set() {} }; }, headers() { return new Map(); } },
  "next/navigation": { useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => searchParams, usePathname: () => "/tournaments", redirect() { throw new Error("redirect"); }, notFound() { throw new Error("notFound"); } },
  "next/link": { __esModule: true, default: (p) => require("react").createElement("a", p, p.children) },
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs[request]) return stubs[request];
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => db };
  if (resolved === CONTEXT) return { requireSeasonContext: async () => ({ profile: { id: "u1", role: "owner" }, organization: { id: "o1" }, season: { id: "s1" } }), canWrite: () => true, getContext: async () => ({}) };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};

const rules = require(path.join(ROOT, "lib", "finance-rules.js"));
const fq = require(path.join(ROOT, "lib", "queries", "finance.js"));

/** Top-level column names in a PostgREST select string (embeds excluded). */
function topColumns(select) {
  let depth = 0, cur = "", out = [];
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter((c) => c && !c.includes(":") && !c.includes("("));
}

/** A table that returns ONLY the selected columns, as PostgREST does. */
function fakeDb(tables) {
  const selects = {};
  return {
    selects,
    from(table) {
      let cols = null;
      const run = () => {
        const rows = tables[table] ?? [];
        const data = cols ? rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))) : rows;
        return { data, error: null };
      };
      const b = {
        select(s) { selects[table] = s; cols = topColumns(s.replace(/\s+/g, " ")); return b; },
        eq() { return b; }, in() { return b; }, order() { return b; },
        update(p) { b.payload = p; db.updates.push({ table, payload: p }); return b; },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
    updates: [],
  };
}

const LINE_A = { id: "A", category: "Tournament Fees", name: "Entry fees", budgeted: 5000, is_income: false };
const LINE_B = { id: "B", category: "Equipment", name: "Gear", budgeted: 1000, is_income: false };
const INCOME = { id: "I", category: "Fundraising", name: "Car wash", budgeted: 500, is_income: true };
const tour = (id, line, cost = 1000, decision = "Committed") => ({ id, name: `Tournament ${id}`, decision, total_cost: cost, budget_item_id: line });
const tx = (id, line, tId, amount, status = "Paid") => ({ id, budget_item_id: line, tournament_id: tId, actual_amount: amount, status, is_income: false, category: "x" });

(async () => {
  /* ---------------- A. the query ---------------- */

  console.log("A. listSeasonTournaments");
  const { listSeasonTournaments } = require(path.join(ROOT, "lib", "queries", "tournaments.js"));
  db = fakeDb({ tournaments: [{ id: "T1", name: "Fall Classic", decision: "Committed", total_cost: 555, budget_item_id: "A", start_date: "2026-08-05", secret_internal: "never" }], games: [], tournament_resources: [] });
  const rows = await listSeasonTournaments("s1");
  assertEq("budget_item_id arrives on each tournament", rows[0].budget_item_id, "A");
  assertEq("a column the query doesn't name never arrives", "secret_internal" in rows[0], false);
  const before = ["id", "name", "start_date", "end_date", "location", "entry_fee", "gate_fee", "total_cost", "travel_type", "decision", "paid_status", "placement", "notes", "event_url", "age_division", "tournament_type", "guaranteed_games", "registration_deadline", "would_play_again", "overall_rating", "history_notes", "contact_id"];
  assertEq("the only column added to the query is budget_item_id",
    topColumns(db.selects.tournaments.replace(/\s+/g, " ")).filter((c) => !before.includes(c)), ["budget_item_id"]);
  assertEq("...and none was removed", before.filter((c) => !topColumns(db.selects.tournaments.replace(/\s+/g, " ")).includes(c)), []);

  /* ---------------- B. drawer figures = Finance figures ---------------- */

  console.log("B. tournamentBudgetLines matches Finance");
  const finance = (items, txs, ts) => {
    const b = fq.buildBudget(items, txs, ts);
    return Object.fromEntries(b.expenses.flatMap((g) => g.rows).sort((x, y) => x.id.localeCompare(y.id)).map((r) => [r.id, { committed: r.committedTotal, paid: r.actual, available: r.available }]));
  };
  const drawer = (items, txs, ts) => Object.fromEntries(rules.tournamentBudgetLines(items, txs, ts).sort((x, y) => x.id.localeCompare(y.id)).map((l) => [l.id, { committed: l.committed, paid: l.paid, available: l.available }]));
  const cases = [
    ["no tournament on any line", [], []],
    ["linked tournament, nothing recorded", [], [tour("T1", "A")]],
    ["linked, $400 Paid on its line (larger-of: still $1,000)", [tx("x1", "A", "T1", 400)], [tour("T1", "A")]],
    ["linked, $1,200 Paid on its line (larger-of: $1,200)", [tx("x1", "A", "T1", 1200)], [tour("T1", "A")]],
    ["ST-011: linked to A, $400 Paid on B", [tx("x1", "B", "T1", 400)], [tour("T1", "A")]],
    ["ST-011: linked to A, $300 on A + $400 To Pay on B", [tx("x1", "A", "T1", 300), tx("x2", "B", "T1", 400, "To Pay")], [tour("T1", "A")]],
    ["Considering and Declined commit nothing", [], [tour("T1", "A", 900, "Considering"), tour("T2", "A", 800, "Declined")]],
    ["two tournaments on one line", [tx("x1", "A", "T1", 100)], [tour("T1", "A", 555), tour("T2", "A", 650)]],
  ];
  for (const [label, txs, ts] of cases) {
    assertEq(`${label}: drawer figures equal Finance's`, drawer([LINE_A, LINE_B, INCOME], txs, ts), finance([LINE_A, LINE_B, INCOME], txs, ts));
  }
  assertEq("the linked tournament's commitment is included in its line ($1,000 on A, $4,000 left)",
    drawer([LINE_A], [], [tour("T1", "A")]).A, { committed: 1000, paid: 0, available: 4000 });
  assertEq("without budget_item_id (the old query) it would be missing — the bug",
    drawer([LINE_A], [], [{ ...tour("T1", "A"), budget_item_id: undefined }]).A.committed, 0);
  assertEq("income lines are not offered to tournaments", rules.tournamentBudgetLines([LINE_A, INCOME], [], []).map((l) => l.id), ["A"]);

  /* ---------------- C. the drawer ---------------- */

  console.log("C. TournamentDetail");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { TournamentDetail } = require(path.join(ROOT, "components", "TournamentClient.js"));
  const lines = rules.tournamentBudgetLines([LINE_A, LINE_B], [tx("x1", "A", "T1", 495)], [tour("T1", "A", 555)]);
  // The budget section lives in the Costs section, which opens on arrival from
  // ?section=costs (the ST-007 path) and is collapsed otherwise.
  searchParams = new URLSearchParams("open=T1&section=costs");
  const base = { id: "T1", name: "Fall Kickoff Classic", decision: "Committed", paid_status: "Paid in Full", total_cost: 555, entry_fee: 495, gate_fee: 60, start_date: "2026-08-05", end_date: "2026-08-06", games: [], resources: [], documents: [] };
  const render = (t, budgetContext) => renderToStaticMarkup(React.createElement(TournamentDetail, {
    t, canWrite: true, isAdmin: true, documentTargets: { players: [], tournaments: [], facilities: [] }, seasonName: "2026-27",
    onClose() {}, onEdit() {}, onDelete() {}, onConfirmDelete() {}, onCancelDelete() {}, onStatus() {},
    budgetContext, budgetLines: lines,
  }));
  {
    const html = render({ ...base, budget_item_id: null }, null);
    assertEq("no budget line: offers Choose, no line context", [/Choose a budget line/.test(html), /Change budget line/.test(html), /used of/.test(html)], [true, false, false]);
  }
  {
    // Exactly how the page picks the context: budgetLines.find(b => b.id === detail.budget_item_id)
    const t = { ...base, budget_item_id: "A" };
    const ctx = lines.find((b) => b.id === t.budget_item_id) ?? null;
    const html = render(t, ctx).replace(/<!-- -->/g, "");
    assertEq("linked: the page finds its line from budget_item_id", ctx?.id, "A");
    assertEq("linked: offers Change, not Choose", [/Change budget line/.test(html), /Choose a budget line/.test(html)], [true, false]);
    assertEq("linked: shows the line's context, including this tournament's commitment",
      [/Entry fees/.test(html), /\$555\.00 used of \$5,000\.00 budget/.test(html), /\$4,445\.00 left/.test(html)], [true, true, true]);
  }
  {
    const src = fs.readFileSync(path.join(ROOT, "components", "FinanceClient.js"), "utf8");
    const tsrc = fs.readFileSync(path.join(ROOT, "components", "TournamentClient.js"), "utf8");
    assertEq("ST-007: Budget Delete links Review tournament to the Costs section",
      /href=\{`\/tournaments\?open=\$\{t\.id\}&section=costs`\}/.test(src), true);
    assertEq("ST-007: the drawer opens Costs on that link", /costs: searchParams\.get\("section"\) === "costs"/.test(tsrc), true);
    const t = { ...base, budget_item_id: "A" };
    const html = render(t, lines.find((b) => b.id === t.budget_item_id));
    assertEq("ST-007: arriving from Review tournament, a linked tournament shows Change budget line, already open",
      [/Change budget line/.test(html), /Choose a budget line/.test(html)], [true, false]);
    searchParams = new URLSearchParams("open=T1");
    assertEq("...without ?section=costs the Costs section starts collapsed (unchanged)",
      /Change budget line/.test(render(t, lines.find((b) => b.id === t.budget_item_id))), false);
    searchParams = new URLSearchParams("open=T1&section=costs");
  }

  /* ---------------- D. changing the line ---------------- */

  console.log("D. setTournamentBudgetLine");
  const { setTournamentBudgetLine } = require(path.join(ROOT, "lib", "actions", "tournaments.js"));
  const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) if (v != null) f.set(k, v); return f; };
  db = fakeDb({});
  assertEq("change the line: writes the new budget_item_id", [(await setTournamentBudgetLine(fd({ tournament_id: "T1", budget_item_id: "B" }))).ok, db.updates[0]?.payload], [true, { budget_item_id: "B" }]);
  db = fakeDb({});
  assertEq("clear the line (Not linked): writes null", [(await setTournamentBudgetLine(fd({ tournament_id: "T1" }))).ok, db.updates[0]?.payload], [true, { budget_item_id: null }]);
  {
    const before = drawer([LINE_A, LINE_B], [], [tour("T1", "A")]);
    const after = drawer([LINE_A, LINE_B], [], [tour("T1", "B")]);
    assertEq("after changing A → B the commitment moves with it", [before.A.committed, before.B.committed, after.A.committed, after.B.committed], [1000, 0, 0, 1000]);
  }

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
