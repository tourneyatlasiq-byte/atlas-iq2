/**
 * Planned Season Budget: Player Dues privacy (2026-11) — BEHAVIOURAL.
 *
 * The parent report states the team's STANDARD dues only: the amount owed by
 * more than half of the active, non-exempt players (cents, with one-cent
 * team-total splits treated as one amount). It never shows a range, a total, a
 * roster count, an exemption or any other sign that amounts differ, and it
 * blocks rather than guessing when there is no standard.
 *
 *   A. standardDues(), the derivation
 *   B. seasonBudgetReport(), run against an in-memory database: blocking,
 *      the coach-only notice, and a least-disclosure payload
 *   C. the rendered document: what a printed page can and cannot contain
 *
 * Same harness as check-dues-edit.js: SWC from Next.js compiles on the fly,
 * no network or database.
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
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/link") return { __esModule: true, default: (p) => require("react").createElement("a", p, p.children) };
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => db };
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};

const { standardDues } = require(path.join(ROOT, "lib", "finance-rules.js"));

/* ---------------- fixtures ---------------- */

const ids = (n, prefix = "p") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
/** Rows shaped like listPlayerPayments() output. */
const owe = (playerIds, amount) => playerIds.map((id) => ({ player_id: id, totalDue: amount, exempt: false }));
const exempt = (playerIds) => playerIds.map((id) => ({ player_id: id, totalDue: 0, exempt: true }));
const sd = (rows, roster) => standardDues(rows, roster);

/* ---------------- A. the derivation ---------------- */

console.log("A. standardDues");
{
  const r = ids(9);
  assertEq("all players the same amount", sd(owe(r, 1200), r), { status: "standard", amount: 1200, individualCount: 0 });
}
{
  const r = ids(10);
  assertEq("one reduced player", sd([...owe(r.slice(0, 9), 2000), ...owe(r.slice(9), 1500)], r),
    { status: "standard", amount: 2000, individualCount: 1 });
}
{
  const r = ids(10);
  assertEq("several reduced players, standard still a strict majority (6 of 10)",
    sd([...owe(r.slice(0, 6), 3000), ...owe(r.slice(6, 8), 2500), ...owe(r.slice(8), 2000)], r),
    { status: "standard", amount: 3000, individualCount: 4 });
}
{
  const r = ids(10);
  assertEq("exempt players neither vote nor change the amount (7 at $500, 3 exempt)",
    sd([...owe(r.slice(0, 7), 500), ...exempt(r.slice(7))], r), { status: "standard", amount: 500, individualCount: 3 });
}
{
  const r = ids(13);
  assertEq("Mower-equivalent: 12 at $3,600, 1 at $3,000 -> $3,600",
    sd([...owe(r.slice(0, 12), 3600), ...owe(r.slice(12), 3000)], r), { status: "standard", amount: 3600, individualCount: 1 });
}
{
  const r = ids(14);
  assertEq("Lynch-equivalent: 12 at $4,000, 2 exempt -> $4,000",
    sd([...owe(r.slice(0, 12), 4000), ...exempt(r.slice(12))], r), { status: "standard", amount: 4000, individualCount: 2 });
}
{
  const r = ids(11);
  assertEq("Northgate-equivalent: 10 at $2,400, 1 at $2,000 -> $2,400",
    sd([...owe(r.slice(0, 10), 2400), ...owe(r.slice(10), 2000)], r), { status: "standard", amount: 2400, individualCount: 1 });
}
{
  const r = ids(12);
  assertEq("exactly 50/50 blocks", sd([...owe(r.slice(0, 6), 3000), ...owe(r.slice(6), 2500)], r).status, "no-majority");
}
{
  const r = ids(9);
  assertEq("three different amounts, no majority, blocks",
    sd([...owe(r.slice(0, 4), 3000), ...owe(r.slice(4, 7), 2500), ...owe(r.slice(7), 2000)], r).status, "no-majority");
}
{
  const r = ids(4);
  assertEq("half of the CHARGED players is not a majority, even with exempt players present (2 + 2 + 2 exempt)",
    sd([...owe(r.slice(0, 2), 3000), ...owe(r.slice(2), 2500), ...exempt(["x1", "x2"])], [...r, "x1", "x2"]).status, "no-majority");
}
{
  const r = ids(5);
  assertEq("all exempt blocks", sd(exempt(r), r), { status: "all-exempt", amount: null, individualCount: 0 });
}
{
  // $48,000 across 14 by allocateMoney: 8 owe 3428.57 and 6 owe 3428.58.
  const r = ids(14);
  assertEq("one-cent team-total split resolves to the lower amount, with no individual arrangements",
    sd([...owe(r.slice(0, 8), 3428.57), ...owe(r.slice(8), 3428.58)], r), { status: "standard", amount: 3428.57, individualCount: 0 });
  assertEq("...also when the split's larger half has more players",
    sd([...owe(r.slice(0, 3), 3428.57), ...owe(r.slice(3), 3428.58)], r).amount, 3428.57);
  assertEq("...and a reduced player beside a split is still an individual arrangement",
    sd([...owe(r.slice(0, 7), 3428.57), ...owe(r.slice(7, 13), 3428.58), ...owe(r.slice(13), 3000)], r),
    { status: "standard", amount: 3428.57, individualCount: 1 });
}
{
  const r = ids(3);
  assertEq("amounts two cents apart do not merge (1 at $100.00, 1 at $100.01, 1 at $100.02 -> one-cent pairs only)",
    sd([...owe(["p1"], 100), ...owe(["p2"], 100.01), ...owe(["p3"], 100.02)], r), { status: "standard", amount: 100, individualCount: 1 });
  assertEq("cents compared exactly: \"3600.00\" and 3600 are one amount",
    sd([...owe(["p1"], "3600.00"), ...owe(["p2"], 3600), ...owe(["p3"], 3000)], r).amount, 3600);
}
{
  const r = ids(5);
  const inactive = [...owe(["gone1", "gone2", "gone3", "gone4", "gone5", "gone6"], 999), { player_id: null, totalDue: 999, exempt: false }];
  assertEq("inactive and unlinked records never affect the calculation",
    sd([...owe(r.slice(0, 3), 1200), ...owe(r.slice(3), 1000), ...inactive], r), { status: "standard", amount: 1200, individualCount: 2 });
}
assertEq("no dues at all", sd([], ids(4)).status, "none");

/* ---------------- B. the report payload ---------------- */

function fakeDb(tables) {
  return {
    from(table) {
      const filters = [];
      let one = false;
      const run = () => {
        const rows = (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
        return { data: one ? rows[0] ?? null : rows, error: null };
      };
      const b = {
        select() { return b; },
        eq(k, v) { filters.push([k, v]); return b; },
        order() { return b; },
        maybeSingle() { one = true; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
  };
}
const S = "season-1";
function seasonDb({ charged = [], exemptIds = [], inactive = [] }) {
  const roster = [...charged.map(([id]) => id), ...exemptIds];
  return fakeDb({
    seasons: [{ id: S, name: "2026-27", start_date: "2026-08-01", end_date: "2027-07-31",
      team: { id: "t", name: "Bramblewood 14U Gold", organization: { id: "o", name: "Bramblewood Fastpitch", logo_url: null } } }],
    team_season_players: [
      ...roster.map((id) => ({ season_id: S, player_id: id, is_active: true, player: { id, person_type: "player", archived_at: null } })),
      ...inactive.map(([id]) => ({ season_id: S, player_id: id, is_active: false, player: { id, person_type: "player", archived_at: null } })),
    ],
    budget_items: [{ season_id: S, id: "b1", category: "Tournament Fees", name: "Entry fees", budgeted: 5000, is_income: false }],
    budget_transactions: [],
    player_payments: [
      ...charged.map(([id, amt]) => ({ season_id: S, id: `pp-${id}`, player_id: id, initial_cost: amt, exempt: false, player_name: `Player ${id}`, player: { id, full_name: `Player ${id}` }, log: [] })),
      ...exemptIds.map((id) => ({ season_id: S, id: `pp-${id}`, player_id: id, initial_cost: 0, exempt: true, player_name: `Player ${id}`, player: { id, full_name: `Player ${id}` }, log: [] })),
      ...inactive.map(([id, amt]) => ({ season_id: S, id: `pp-${id}`, player_id: id, initial_cost: amt, exempt: false, player_name: `Player ${id}`, player: { id, full_name: `Player ${id}` }, log: [{ amount: 100 }] })),
    ],
  });
}
const mower = { charged: [...ids(12).map((id) => [id, 3600]), ["r1", 3000]] };
const lynch = { charged: ids(12).map((id) => [id, 4000]), exemptIds: ["e1", "e2"] };
const northgate = { charged: [...ids(10).map((id) => [id, 2400]), ["r1", 2000]], inactive: [["gone1", 2400], ["gone2", 2400]] };

(async () => {
  const { seasonBudgetReport } = require(path.join(ROOT, "lib", "queries", "reports", "season-budget.js"));
  const run = async (setup) => { db = seasonDb(setup); return seasonBudgetReport(S); };

  console.log("B. seasonBudgetReport (in-memory database)");
  const reports = { mower: await run(mower), lynch: await run(lynch), northgate: await run(northgate) };
  assertEq("Mower, Lynch and Northgate shapes print $3,600, $4,000 and $2,400",
    [reports.mower.dues, reports.lynch.dues, reports.northgate.dues], [{ perPlayer: 3600 }, { perPlayer: 4000 }, { perPlayer: 2400 }]);
  assertEq("none of them is blocked", [reports.mower.blocked, reports.lynch.blocked, reports.northgate.blocked], [false, false, false]);
  assertEq("the dues payload carries the standard amount and nothing else",
    Object.values(reports).map((r) => Object.keys(r.dues)), [["perPlayer"], ["perPlayer"], ["perPlayer"]]);
  {
    const page = (r) => JSON.stringify({ ...r, warnings: [] });
    const leaks = (r, values) => values.filter((v) => page(r).includes(v));
    assertEq("the page data contains no alternative obligation, range or total (Mower: 3000, 46800, 43200)",
      leaks(reports.mower, ["3000", "46800", "43200", "\"min\"", "\"max\"", "expectedTotal", "status", "activeRosterCount"]), []);
    assertEq("...no exemption information (Lynch)", leaks(reports.lynch, ["exempt", "Exempt", "48000", "\"min\"", "\"max\""]), []);
    assertEq("...no reduced amount (Northgate: 2000, 26000)", leaks(reports.northgate, ["2000", "26000", "\"min\"", "\"max\""]), []);
  }
  {
    const notice = (r) => r.warnings.filter((w) => !w.blocking).map((w) => w.message);
    assertEq("Mower: one coach-only notice about individual arrangements",
      notice(reports.mower).filter((m) => /individual arrangement/.test(m)),
      ["This report shows the standard player dues of $3,600.00. 1 player has an individual arrangement that isn't shown."]);
    assertEq("Lynch: the two exempt players are counted as individual arrangements in the coach's notice",
      notice(reports.lynch).filter((m) => /individual arrangement/.test(m)),
      ["This report shows the standard player dues of $4,000.00. 2 players have individual arrangements that aren't shown."]);
  }
  {
    const r = await run({ charged: ids(9).map((id) => [id, 1200]) });
    assertEq("all the same: no coach notice about arrangements",
      r.warnings.some((w) => /individual arrangement/.test(w.message)), false);
  }
  {
    const r = await run({ charged: [...ids(6).map((id) => [id, 3000]), ...ids(6, "q").map((id) => [id, 2500])] });
    assertEq("50/50 split: blocked, and no amount is offered", [r.blocked, r.dues.perPlayer, r.warnings.find((w) => w.blocking)?.title],
      [true, null, "No standard dues amount"]);
  }
  {
    const r = await run({ exemptIds: ids(5, "e") });
    assertEq("all exempt: blocked", [r.blocked, r.dues.perPlayer, r.warnings.find((w) => w.blocking)?.title],
      [true, null, "No player is charged dues"]);
  }
  {
    const r = await run({ charged: [["p1", 1200], ["p2", 1200]], inactive: [["gone1", 1500], ["gone2", 1500], ["gone3", 1500]] });
    assertEq("inactive players' records do not affect the amount", r.dues.perPlayer, 1200);
  }

  /* ---------------- C. the document ---------------- */

  console.log("C. the rendered document");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { SeasonBudgetReport } = require(path.join(ROOT, "components", "reports", "SeasonBudgetReport.js"));
  const docOf = (r) => {
    const html = renderToStaticMarkup(React.createElement(SeasonBudgetReport, { report: r }));
    const start = html.indexOf('<article class="rpt-page"');
    return start < 0 ? "" : html.slice(start).replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "’").replace(/\s+/g, " ");
  };
  for (const [name, r] of Object.entries(reports)) {
    const doc = docOf(r);
    assertEq(`${name}: the dues card is exactly Player dues, the standard, per player — no disclaimer`,
      /Player dues \$[\d,]+ per player (Fundraising|Budget amounts)/.test(doc), true);
    assertEq(`${name}: no "confirmed separately" line`, /confirmed separately/i.test(doc), false);
    assertEq(`${name}: no "vary", no range, no exemption, no arrangement, no roster count, no team total`,
      [/var(y|ies)/i.test(doc), /\$[\d,.]+\s*[–-]\s*\$[\d,.]+/.test(doc), /exempt/i.test(doc), /arrangement/i.test(doc),
        /players? on (the|this) roster/i.test(doc), /from the \d+ players/i.test(doc)],
      [false, false, false, false, false, false]);
  }
  {
    const split = await run({ charged: [...ids(8).map((id) => [id, 3428.57]), ...ids(6, "q").map((id) => [id, 3428.58])] });
    assertEq("a one-cent split prints its lower amount to the cent, not rounded up",
      /\$3,428\.57 per player/.test(docOf(split)), true);
  }
  {
    const html = renderToStaticMarkup(React.createElement(SeasonBudgetReport, { report: reports.mower }));
    const bar = html.slice(0, html.indexOf('<article class="rpt-page"'));
    assertEq("the coach notice is in the screen-only toolbar, not the document",
      [/rpt-no-print/.test(bar) && /individual arrangement/.test(bar), /individual arrangement/.test(docOf(reports.mower))], [true, false]);
  }

  {
    const doc = docOf(reports.mower);
    assertEq("header reads Updated <date>, not Prepared", [/· Updated [A-Z][a-z]+ \d{1,2}, \d{4}/.test(doc), /Prepared/.test(doc)], [true, false]);
    assertEq("the closing note uses the approved wording",
      /Budget amounts reflect the team’s current season plan and may change as the season develops\./.test(doc), true);
    const css = fs.readFileSync(path.join(ROOT, "app", "reports", "season-budget", "report.css"), "utf8");
    assertEq("cards size to their own content (no stretched blank space)", /\.rpt-cards \{[^}]*align-items:\s*start/.test(css), true);
  }

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
