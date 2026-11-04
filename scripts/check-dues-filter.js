/**
 * ST-010 — Player Dues under a Needs Attention filter, and player-specific
 * Set Dues. 2026-11.
 *
 * The defect: under a filter, the list reconciled the roster against only the
 * filtered dues records, so Allie Cox ($3,600 due, $3,600 paid) showed as
 * "Dues not set" and her Set dues button opened an empty player picker.
 *
 * Behavioural checks:
 *   A. the rules: states from the complete dataset, filters only narrow rows
 *   B. PaymentsTab rendered under every filter
 *   C. PaymentForm opened for a known player, in every dues state
 *   D. server protections: payment floor, bulk refusal, duplicate obligation
 *
 * Same harness as check-dues-edit.js: SWC from Next.js, stubbed framework and
 * database modules, no network.
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

/* ---------------- module loading ---------------- */

const STUB_DIR = path.join(ROOT, "scripts", "__dues_filter_stubs__");
const stubs = new Map();
const stub = (name, exportsObj) => stubs.set(name, exportsObj);
let db = null;
stub("next/cache", { revalidatePath() {} });
stub("next/headers", { cookies() { return { get() {}, set() {} }; }, headers() { return new Map(); } });
stub("next/navigation", {
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/finance",
  redirect() { throw new Error("redirect"); },
  notFound() { throw new Error("notFound"); },
});
stub("next/link", { __esModule: true, default: (props) => require("react").createElement("a", props, props.children) });
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const CONTEXT = path.join(ROOT, "lib", "context.js");

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (stubs.has(request)) return `${STUB_DIR}/${request}`;
  return origResolve.call(this, request, parent, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  const resolved = (() => { try { return Module._resolveFilename(request, parent); } catch { return null; } })();
  if (resolved === SUPABASE_SERVER) return { createClient: () => db };
  if (resolved === CONTEXT) {
    return {
      requireSeasonContext: async () => ({ profile: { role: "owner" }, organization: { id: "org-1" }, season: { id: "season-1" } }),
      canWrite: () => true,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const swc = require("next/dist/build/swc");
const SWC_OPTS = {
  jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" },
  module: { type: "commonjs" },
};
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(module, filename);
  let src = fs.readFileSync(filename, "utf8");
  if (filename === path.join(ROOT, "components", "FinanceClient.js")) {
    src += "\nexport { PaymentForm as __PaymentForm };\n";
  }
  const { code } = swc.transformSync(src, { ...SWC_OPTS, filename });
  module._compile(code, filename);
};

const {
  reconcileDues, actionPlayerIds, scopeReconciledDues, duesHeaderState, presetDuesTarget,
} = require(path.join(ROOT, "lib", "finance-rules.js"));
const { financeActions } = require(path.join(ROOT, "lib", "readiness", "finance.js"));

/* ---------------- fixture: one player in every state ---------------- */

// [name, active, record: null | { due, paid[], exempt }]
const FIXTURE = [
  ["Allie Cox", true, { due: 3600, paid: [3600] }],          // paid in full (the reported player)
  ["Anna Owes", true, { due: 3600, paid: [500, 600] }],      // partially paid
  ["Nora None", true, { due: 3600, paid: [] }],              // not started
  ["Ellie Exempt", true, { due: 0, paid: [], exempt: true }], // exempt
  ["Nia Notset", true, null],                                // genuinely no dues
  ["Olivia Former", false, { due: 3600, paid: [] }],         // inactive, historical dues
];
const players = FIXTURE.filter(([, active]) => active)
  .map(([name]) => ({ id: name, full_name: name, person_type: "player" }));
const payments = FIXTURE.filter(([, , r]) => r).map(([name, , r]) => {
  const totalPaid = r.paid.reduce((a, b) => a + b, 0);
  return {
    id: `pay-${name}`, player_id: name, player: { full_name: name }, displayName: name,
    initial_cost: r.due, exempt: !!r.exempt, totalDue: r.due, totalPaid, balance: r.due - totalPaid,
    log: r.paid.map((amount, i) => ({ id: `${name}-log-${i}`, amount })),
  };
});
const roster = players.map((p) => ({ player_id: p.id, player: p }));

const EXPECTED = {
  "Allie Cox": "paid", "Anna Owes": "owes", "Nora None": "not-started",
  "Ellie Exempt": "exempt", "Nia Notset": "not-set",
};

async function main() {
  /* ---------------- A. rules ---------------- */
  console.log("A. dues state is decided from the complete dataset");
  const full = reconcileDues(players, payments);
  const stateOf = (rec, name) => rec.roster.find((r) => r.playerId === name)?.state ?? null;
  assertEq("unfiltered: every active player has the right state",
    Object.fromEntries(Object.keys(EXPECTED).map((n) => [n, stateOf(full, n)])), EXPECTED);
  assertEq("unfiltered: the inactive player's historical dues are a former record, not a roster row",
    [stateOf(full, "Olivia Former"), full.former.map((f) => [f.name, f.kind])], [null, [["Olivia Former", "former"]]]);

  const actions = financeActions(payments, roster);
  assertEq("Needs Attention offers the three filters for this team",
    actions.map((a) => a.id).sort(), ["no-dues", "not-started", "outstanding"]);

  const filters = [["no filter", null], ...actions.map((a) => [a.id, a])];
  for (const [label, action] of filters) {
    const ids = actionPlayerIds(action);
    const scoped = scopeReconciledDues(full, ids);
    const shown = scoped.roster.map((r) => [r.name, r.state]);
    assertEq(`[${label}] every row shown keeps its unfiltered state`,
      shown.every(([n, s]) => EXPECTED[n] === s), true);
    assertEq(`[${label}] "Dues not set" is shown only for a player with no record`,
      scoped.roster.filter((r) => r.state === "not-set").map((r) => r.name).every((n) => !payments.some((p) => p.player_id === n)), true);
    assertEq(`[${label}] Allie is never "Dues not set"`,
      scoped.roster.some((r) => r.name === "Allie Cox" && r.state === "not-set"), false);
    assertEq(`[${label}] the rows shown are exactly the filter's players`,
      [...scoped.roster, ...scoped.former].map((r) => r.playerId).sort(),
      ids ? [...ids].sort() : [...players.map((p) => p.id), "Olivia Former"].sort());
    assertEq(`[${label}] view counts describe the rows shown`,
      [scoped.counts.all, scoped.counts.notSet, scoped.counts.paid],
      [scoped.roster.length, scoped.roster.filter((r) => r.state === "not-set").length, scoped.roster.filter((r) => r.state === "paid").length]);
    const header = duesHeaderState(payments, full.counts);
    assertEq(`[${label}] financial actions come from the complete season (payments exist: no Edit team dues)`,
      [header.canBulkEdit, header.anyPaid, header.playersWithoutDues, header.withDuesCount], [false, true, 1, 5]);
  }
  {
    const outstanding = actions.find((a) => a.id === "outstanding");
    assertEq("[outstanding] Allie (paid in full) is not in the owing filter at all",
      scopeReconciledDues(full, actionPlayerIds(outstanding)).roster.some((r) => r.name === "Allie Cox"), false);
    assertEq("[outstanding] the inactive player's balance is shown as a former record",
      scopeReconciledDues(full, actionPlayerIds(outstanding)).former.map((f) => f.name), ["Olivia Former"]);
    const noDues = actions.find((a) => a.id === "no-dues");
    assertEq("[no-dues] shows the genuinely-unset player, and only her (previously an empty list)",
      scopeReconciledDues(full, actionPlayerIds(noDues)).roster.map((r) => [r.name, r.state]), [["Nia Notset", "not-set"]]);

    // The defect, reproduced with the old approach, so this check fails loudly
    // if anyone reintroduces "filter the records, then reconcile".
    const oldWay = reconcileDues(players, payments.filter((p) => outstanding.affected.some((a) => a.player_id === p.player_id)));
    assertEq("the old approach (filter records, then reconcile) made Allie 'not-set' — the reported bug",
      stateOf(oldWay, "Allie Cox"), "not-set");
  }
  {
    const before = JSON.stringify(full);
    scopeReconciledDues(full, new Set(["Nia Notset"]));
    assertEq("narrowing never modifies the full reconciliation", JSON.stringify(full), before);
    assertEq("no filter returns the full reconciliation unchanged", scopeReconciledDues(full, null), full);
    assertEq("actionPlayerIds(null) means no filter", actionPlayerIds(null), null);
  }
  {
    const unpaid = payments.map((p) => ({ ...p, log: [], totalPaid: 0, balance: p.totalDue }));
    const h = duesHeaderState(unpaid, reconcileDues(players, unpaid).counts);
    assertEq("no payments anywhere: Edit team dues allowed (unchanged rule)", h.canBulkEdit, true);
    assertEq("no dues anywhere: Edit team dues not offered", duesHeaderState([], { notSet: 5 }).canBulkEdit, false);
  }
  {
    assertEq("preset target: no record -> set directly", presetDuesTarget("Nia Notset", players, payments)?.kind, "set");
    assertEq("preset target: Allie has a record -> exists", presetDuesTarget("Allie Cox", players, payments)?.record?.id, "pay-Allie Cox");
    assertEq("preset target: exempt has a record -> exists", presetDuesTarget("Ellie Exempt", players, payments)?.kind, "exists");
    assertEq("preset target: inactive with historical dues -> exists (its record)", presetDuesTarget("Olivia Former", players, payments)?.kind, "exists");
    assertEq("preset target: not an active player, no record -> ineligible", presetDuesTarget("Coach Kim", players, payments)?.kind, "ineligible");
    assertEq("preset target: no preset -> none", presetDuesTarget(null, players, payments), null);
  }

  /* ---------------- B. PaymentsTab rendered ---------------- */
  console.log("B. PaymentsTab under every filter");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const consoleError = console.error;
  console.error = (msg, ...rest) => {
    if (typeof msg === "string" && msg.includes("Invalid value for prop") && rest.includes("`action`")) return;
    consoleError(msg, ...rest);
  };
  const FC = require(path.join(ROOT, "components", "FinanceClient.js"));
  const noop = () => {};
  const tab = (action, pays = payments) => renderToStaticMarkup(React.createElement(FC.PaymentsTab, {
    payments: pays, filterPlayerIds: actionPlayerIds(action), activePlayers: players, canWrite: true,
    onAdd: noop, onAddFor: noop, onOpen: noop, onBulk: noop, onEditTeamDues: noop, pending: false,
    filtered: Boolean(action), filterLabel: action ? "in this filter" : null, onClearFilter: noop,
  }));
  const rows = (html) => (html.split("<tbody>")[1] ?? "").split("<tr").slice(1).map((tr) => ({
    name: (tr.match(/class="cell-name">([^<]*)/) || [])[1], unset: /Dues not set/.test(tr),
  }));

  for (const [label, action] of filters) {
    const html = tab(action);
    const r = rows(html);
    assertEq(`[${label}] rendered: "Dues not set" appears only on Nia's row`,
      r.filter((x) => x.unset).map((x) => x.name).every((n) => n === "Nia Notset"), true);
    assertEq(`[${label}] rendered: Allie's row, if shown, is not "Dues not set"`,
      r.some((x) => x.name === "Allie Cox" && x.unset), false);
    assertEq(`[${label}] rendered: Edit team dues not offered (payments exist)`, /Edit team dues/.test(html), false);
    assertEq(`[${label}] rendered: the "payments recorded" note is shown`, /Team dues can no longer be reallocated as a group/.test(html), true);
    assertEq(`[${label}] rendered: header states the full season: 5 players, 1 without dues`,
      /5 players[\s\S]*?1 without dues set/.test(html), true);
  }
  {
    const html = tab(null);
    assertEq("no filter: Allie renders as Paid in full", /Allie Cox[\s\S]*?Paid in full/.test(html.split("Anna Owes")[0]), true);
  }
  {
    const unpaid = payments.map((p) => ({ ...p, log: [], totalPaid: 0, balance: p.totalDue }));
    const notStarted = financeActions(unpaid, roster).find((a) => a.id === "not-started");
    assertEq("no payments: Edit team dues offered with no filter", /Edit team dues/.test(tab(null, unpaid)), true);
    assertEq("no payments: ...and still offered under a filter", /Edit team dues/.test(tab(notStarted, unpaid)), true);
    const outstandingOnly = { id: "outstanding", affected: [{ player_id: "Anna Owes" }] };
    assertEq("payments exist but the filter shows only unpaid rows: still not offered (was the second symptom)",
      /Edit team dues/.test(tab({ id: "not-started", affected: [{ player_id: "Nora None" }] })), false);
    assertEq("a filter showing only players with dues does not fake 'no dues set up yet'",
      /No player dues yet/.test(tab(outstandingOnly)), false);
  }

  /* ---------------- C. PaymentForm for a known player ---------------- */
  console.log("C. Set Dues for a known player");
  const PaymentForm = FC.__PaymentForm;
  const formFor = (presetPlayerId, extra = {}) => renderToStaticMarkup(React.createElement(PaymentForm, {
    row: null, players, existing: payments, presetPlayerId, pending: false, onSubmit: noop, onCancel: noop,
    onOpenExisting: noop, ...extra,
  }));
  const submit = (html) => {
    const m = html.match(/<button type="submit"[^>]*>([^<]*)<\/button>/);
    return m ? { label: m[1], disabled: /\sdisabled=""/.test(m[0]) } : null;
  };
  {
    const html = formFor("Nia Notset");
    assertEq("no dues: titled with the player's name", /Set dues for Nia Notset/.test(html), true);
    assertEq("no dues: no All players / One player choice", /Who owes this\?/.test(html), false);
    assertEq("no dues: no player picker to re-select her", /id="p-player"/.test(html), false);
    assertEq("no dues: the player is fixed in the form", /<input type="hidden" name="player_id" value="Nia Notset"/.test(html), true);
    assertEq("no dues: amount field for that player", /Player dues for the season/.test(html), true);
    assertEq("no dues: Set dues available", submit(html), { label: "Set dues", disabled: false });
  }
  {
    const html = formFor("Allie Cox");
    assertEq("Allie (has dues): says dues are already set", /Dues already set for Allie Cox/.test(html), true);
    assertEq("Allie: states $3,600.00 owed and $3,600.00 paid", /\$3,600\.00<\/strong> for this season[\s\S]*?\$3,600\.00/.test(html), true);
    assertEq("Allie: offers the way to her dues", /View Allie Cox&#x27;s dues|View Allie Cox’s dues/.test(html), true);
    assertEq("Allie: no empty selector, no form, nothing to submit", [/id="p-player"/.test(html), /<form/.test(html), submit(html)], [false, false, null]);
  }
  {
    const html = formFor("Ellie Exempt");
    assertEq("exempt: already set, described as exempt (never 'paid')", [/Dues already set for Ellie Exempt/.test(html), /exempt from dues/.test(html), /has paid/.test(html)], [true, true, false]);
  }
  {
    const html = formFor("Coach Kim");
    assertEq("not an active player: explained, nothing to submit", [/isn.{1,8}t an active player/.test(html), submit(html)], [true, null]);
  }
  {
    const html = formFor(null);
    assertEq("header path (no known player): All / One choice unchanged", /Who owes this\?/.test(html), true);
    const team = renderToStaticMarkup(React.createElement(PaymentForm, {
      row: null, teamEdit: true, players, existing: payments, pending: false, onSubmit: noop, onCancel: noop,
    }));
    assertEq("Edit team dues form unchanged by this finding (ST-009 left alone)", /Edit team dues/.test(team) && /Who owes this\?/.test(team), true);
    const edit = renderToStaticMarkup(React.createElement(PaymentForm, {
      row: { ...payments[0], player: { full_name: "Allie Cox" } }, players, existing: payments, pending: false, onSubmit: noop, onCancel: noop,
    }));
    assertEq("Edit total due for an existing obligation unchanged", [/Edit Allie Cox/.test(edit), submit(edit)], [true, { label: "Save changes", disabled: true }]);
  }
  {
    const src = fs.readFileSync(path.join(ROOT, "components", "FinanceClient.js"), "utf8");
    assertEq("View dues closes the form and opens that player's dues record",
      /onOpenExisting=\{\(record\) => \{\s*setEditPay\(null\);\s*setDuesForPlayer\(null\);\s*openDetail\(record\);/.test(src), true);
    assertEq("the list receives every record, never a filtered set",
      /<PaymentsTab\s+payments=\{payments\}\s+filterPlayerIds=\{filterPlayerIds\}/.test(src) && !/visiblePayments/.test(src), true);
  }

  /* ---------------- D. server protections ---------------- */
  console.log("D. server protections unchanged");
  function fakeDb({ paidByPayment = {}, obligations = [], insertError = null }) {
    const writes = [];
    const from = (table) => {
      const q = { table, op: "select", filters: {}, payload: null };
      const result = () => {
        if (q.op === "insert") return { data: null, error: insertError };
        if (q.op !== "select") return { data: null, error: null };
        if (table === "team_season_players") return { data: { player_id: q.filters.player_id }, error: null };
        if (table === "payment_log") return { data: (paidByPayment[q.filters.payment_id] ?? []).map((amount) => ({ amount })), error: null };
        if (table === "player_payments") return { data: obligations, error: null };
        return { data: [], error: null };
      };
      const b = {
        select() { return b; },
        eq(c, v) { q.filters[c] = v; return b; },
        order() { return b; },
        maybeSingle() { return Promise.resolve(result()); },
        single() { return Promise.resolve(result()); },
        update(p) { q.op = "update"; q.payload = p; writes.push(q); return b; },
        insert(p) { q.op = "insert"; q.payload = p; writes.push(q); return b; },
        upsert(p) { q.op = "upsert"; q.payload = p; writes.push(q); return b; },
        delete() { q.op = "delete"; writes.push(q); return b; },
        then(res, rej) { return Promise.resolve(result()).then(res, rej); },
      };
      return b;
    };
    return { from, writes };
  }
  const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  const { savePlayerPayment, editDuesForAll } = require(path.join(ROOT, "lib", "actions", "finance.js"));

  db = fakeDb({});
  assertEq("setting dues for the no-dues player creates exactly one obligation",
    [await savePlayerPayment(fd({ player_id: "Nia Notset", initial_cost: "3600" })), db.writes.map((w) => [w.table, w.op, w.payload.player_id, w.payload.initial_cost])],
    [{ ok: true }, [["player_payments", "insert", "Nia Notset", 3600]]]);

  db = fakeDb({ insertError: { message: 'duplicate key value violates unique constraint "player_payments_one_per_player_season"' } });
  const dup = await savePlayerPayment(fd({ player_id: "Allie Cox", initial_cost: "3600" }));
  assertEq("a second obligation for Allie is refused (one per player per season)", [dup.ok, /player_payments_one_per_player_season/.test(dup.error)], [false, true]);
  assertEq("...and nothing else is written", db.writes.map((w) => [w.table, w.op]), [["player_payments", "insert"]]);

  db = fakeDb({ paidByPayment: { "pay-Allie Cox": [3600] } });
  const low = await savePlayerPayment(fd({ id: "pay-Allie Cox", player_id: "Allie Cox", initial_cost: "3599.99" }));
  assertEq("floor: Allie's Total Due can't go below her $3,600 paid, nothing written", [low.ok, db.writes.length], [false, 0]);
  db = fakeDb({ paidByPayment: { "pay-Allie Cox": [3600] } });
  assertEq("floor: exactly $3,600 is allowed", (await savePlayerPayment(fd({ id: "pay-Allie Cox", player_id: "Allie Cox", initial_cost: "3600" }))).ok, true);
  db = fakeDb({ paidByPayment: { "pay-Allie Cox": [3600] } });
  const ex = await savePlayerPayment(fd({ id: "pay-Allie Cox", player_id: "Allie Cox", initial_cost: "0", exempt: "true" }));
  assertEq("floor: can't mark Allie exempt over $3,600 paid, nothing written", [ex.ok, db.writes.length], [false, 0]);

  db = fakeDb({ obligations: payments.map((p) => ({ id: p.id, player_id: p.player_id, initial_cost: p.totalDue, exempt: p.exempt, log: p.log, player: p.player })) });
  const bulk = await editDuesForAll(fd({ initial_cost: "40000", dues_mode: "total" }));
  assertEq("bulk: Edit team dues refused whole once any payment exists, nothing written",
    [bulk.ok, bulk.hasPayments, db.writes.length], [false, true, 0]);

  console.log(`\nDues filter (ST-010): ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
