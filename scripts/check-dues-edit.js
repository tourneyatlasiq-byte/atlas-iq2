/**
 * ST-005 follow-up — Player Dues form (PaymentForm) behaviour, 2026-10.
 *
 * The first ST-005 fix was covered only by source-text assertions, which
 * passed while the live Edit total due button stayed disabled. These checks
 * exercise real behaviour instead:
 *
 *   A. canSaveDuesForm, the one rule behind the Save button.
 *   B. PaymentForm itself, rendered with React for each way it opens
 *      (Edit total due, Set player dues for all / one, Edit team dues).
 *   C. savePlayerPayment, the server action, run against an in-memory
 *      Supabase stand-in so the payment floor and "payment history is never
 *      written" are proven by what the action actually does.
 *
 * JSX and ESM are compiled on the fly with the SWC compiler that ships inside
 * Next.js, so nothing new is added to package.json. Framework and database
 * modules are replaced with small stand-ins; no network or database is used.
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

const STUB_DIR = path.join(ROOT, "scripts", "__dues_stubs__");
const stubs = new Map();
function stub(name, exportsObj) { stubs.set(name, exportsObj); }

// Server-side stand-ins, swapped per test via `db`.
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
      requireSeasonContext: async () => ({
        profile: { role: "owner" },
        organization: { id: "org-1" },
        season: { id: "season-1" },
      }),
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
  // PaymentForm is file-private; expose it to this check only.
  if (filename === path.join(ROOT, "components", "FinanceClient.js")) {
    src += "\nexport { PaymentForm as __PaymentForm };\n";
  }
  const { code } = swc.transformSync(src, { ...SWC_OPTS, filename });
  module._compile(code, filename);
};

/* ---------------- A. the Save rule ---------------- */

const { canSaveDuesForm } = require(path.join(ROOT, "lib", "finance-rules.js"));
console.log("A. canSaveDuesForm");

const edit = (amount, extra = {}) =>
  canSaveDuesForm({ mode: "edit", amount, originalAmount: 2400, ...extra });

assertEq("edit: $2,400 -> $2,000 enables Save", edit("2000"), true);
assertEq("edit: $2,400 -> $1,200 enables Save (the server decides the floor)", edit("1200"), true);
assertEq("edit: unchanged $2,400 does not enable Save", edit(2400), false);
assertEq("edit: \"2400.00\" typed over 2400 is unchanged, Save stays off", edit("2400.00"), false);
assertEq("edit: \"2400.001\" rounds to the same cents, Save stays off", edit("2400.001"), false);
assertEq("edit: a one-cent change enables Save", edit("2399.99"), true);
assertEq("edit: a blank amount does not enable Save", edit(""), false);
assertEq("edit: a negative amount does not enable Save", edit("-5"), false);
assertEq("edit: non-numeric text does not enable Save", edit("abc"), false);
assertEq("edit: a $0 obligation can be raised", canSaveDuesForm({ mode: "edit", amount: "500", originalAmount: 0 }), true);
assertEq("edit: nothing is savable while a save is in flight", edit("2000", { pending: true }), false);
assertEq("edit: the outcome ignores how many players lack dues (the old bug)",
  [0, 1, 13].map((n) => canSaveDuesForm({ mode: "edit", amount: "2000", originalAmount: 2400, selectedCount: n })),
  [true, true, true]);
assertEq("bulk: at least one selected player enables Save", canSaveDuesForm({ mode: "bulk", amount: "", selectedCount: 3 }), true);
assertEq("bulk: no selected players keeps Save off (unchanged behaviour)", canSaveDuesForm({ mode: "bulk", amount: "100", selectedCount: 0 }), false);
assertEq("one: setting dues for one player stays available (unchanged behaviour)", canSaveDuesForm({ mode: "one", amount: "" }), true);

/* ---------------- B. PaymentForm rendered ---------------- */

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
// React 18's server renderer warns that a function form `action` (a Next.js
// server-action form) can't be serialised to HTML. Expected here; muted so
// real failures stay readable.
const consoleError = console.error;
console.error = (msg, ...rest) => {
  if (typeof msg === "string" && msg.includes("Invalid value for prop") && rest.includes("`action`")) return;
  consoleError(msg, ...rest);
};
const { __PaymentForm: PaymentForm } = require(path.join(ROOT, "components", "FinanceClient.js"));
console.log("B. PaymentForm rendered");

const roster = Array.from({ length: 13 }, (_, i) => ({
  id: `p${i + 1}`, full_name: i === 0 ? "Cora Lindqvist" : `Player ${i + 1}`, person_type: "player",
}));
const everyoneHasDues = roster.map((p, i) => ({ id: `pay${i + 1}`, player_id: p.id }));
const coraRow = { id: "pay1", player_id: "p1", totalDue: 2400, totalPaid: 1200, player: { full_name: "Cora Lindqvist" } };
const noop = () => {};

function render(props) {
  return renderToStaticMarkup(React.createElement(PaymentForm, {
    players: roster, existing: everyoneHasDues, pending: false, onSubmit: noop, onCancel: noop, ...props,
  }));
}
function submitButton(html) {
  const m = html.match(/<button type="submit"[^>]*>([^<]*)<\/button>/);
  return m ? { label: m[1], disabled: /\sdisabled=""/.test(m[0]) } : null;
}

{
  const html = render({ row: coraRow });
  assertEq("Edit total due opens (no crash) with the player's name", /Edit Cora Lindqvist/.test(html), true);
  assertEq("...pre-filled with the current $2,400", /value="2400"/.test(html), true);
  assertEq("...Save is off until the amount changes, even with every player already owing dues",
    submitButton(html), { label: "Save changes", disabled: true });
  assertEq("...and no error is shown in a freshly opened form, even if the page has one",
    /role="alert"/.test(render({ row: coraRow, formError: "an older, unrelated error" })), false);
}
{
  const html = render({ row: null, existing: everyoneHasDues.slice(3) });
  assertEq("Set player dues (all players) opens", /Set player dues/.test(html), true);
  assertEq("...offers the 3 players who have no dues yet, Save available",
    submitButton(html), { label: "Set dues for 3 players", disabled: false });
}
{
  const html = render({ row: null });
  assertEq("Set player dues when everyone already has dues: Save stays off (unchanged)",
    submitButton(html), { label: "Set dues for 0 players", disabled: true });
}
{
  const html = render({ row: null, presetPlayerId: "p2", existing: everyoneHasDues.slice(2) });
  assertEq("Set dues for one specific player opens on that player, Add available",
    submitButton(html), { label: "Add", disabled: false });
}
{
  const html = render({ row: null, teamEdit: true });
  assertEq("Edit team dues opens", /Edit team dues/.test(html), true);
  assertEq("...states it replaces the amount for the 13 players who have dues",
    /This replaces the amount owed by.*<strong>13<\/strong>/.test(html), true);
  assertEq("...Save available for those 13 players",
    submitButton(html), { label: "Set dues for 13 players", disabled: false });
}
{
  const html = render({ row: coraRow, pending: true });
  assertEq("while saving, the button shows Saving… and is off", submitButton(html), { label: "Saving…", disabled: true });
}

/* ---------------- C. savePlayerPayment against an in-memory database ---------------- */

function fakeDb({ paid }) {
  const writes = [];
  function builder(table) {
    const q = { table, op: "select", filters: {}, payload: null };
    const result = () => {
      if (q.op !== "select") return { data: null, error: null };
      if (table === "team_season_players") return { data: { player_id: q.filters.player_id }, error: null };
      if (table === "payment_log") return { data: paid.map((amount) => ({ amount })), error: null };
      return { data: [], error: null };
    };
    const b = {
      select() { return b; },
      eq(col, val) { q.filters[col] = val; return b; },
      maybeSingle() { return Promise.resolve(result()); },
      single() { return Promise.resolve(result()); },
      update(payload) { q.op = "update"; q.payload = payload; writes.push(q); return b; },
      insert(payload) { q.op = "insert"; q.payload = payload; writes.push(q); return b; },
      delete() { q.op = "delete"; writes.push(q); return b; },
      upsert(payload) { q.op = "upsert"; q.payload = payload; writes.push(q); return b; },
      then(res, rej) { return Promise.resolve(result()).then(res, rej); },
    };
    return b;
  }
  return { from: builder, writes };
}

function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

(async () => {
  const { savePlayerPayment } = require(path.join(ROOT, "lib", "actions", "finance.js"));
  console.log("C. savePlayerPayment (in-memory database, $1,200 already paid)");

  async function edit(cost, extra = {}) {
    db = fakeDb({ paid: [500, 700] }); // $1,200 recorded across two payments
    const res = await savePlayerPayment(form({ id: "pay1", player_id: "p1", initial_cost: cost, ...extra }));
    return { res, writes: db.writes.map((w) => ({ table: w.table, op: w.op, payload: w.payload, id: w.filters.id })) };
  }

  {
    const { res, writes } = await edit("2000");
    assertEq("$2,400 -> $2,000 saves", res, { ok: true });
    assertEq("...writes exactly one change: this obligation's amount",
      writes, [{ table: "player_payments", op: "update", payload: { initial_cost: 2000, exempt: false }, id: "pay1" }]);
    assertEq("...and leaves the $1,200 payment history untouched (no payment_log write)",
      writes.some((w) => w.table === "payment_log"), false);
  }
  {
    const { res, writes } = await edit("1200");
    assertEq("exactly $1,200 (the amount already paid) is allowed", res, { ok: true });
    assertEq("...and saved as $1,200", writes[0]?.payload, { initial_cost: 1200, exempt: false });
  }
  {
    const { res, writes } = await edit("$1,200.00");
    assertEq("\"$1,200.00\" pasted with symbol and comma is also allowed", res, { ok: true });
    assertEq("...saved as 1200", writes[0]?.payload?.initial_cost, 1200);
  }
  {
    const { res, writes } = await edit("1199.99");
    assertEq("$1,199.99 is rejected", res.ok, false);
    assertEq("...with a message naming the $1,200.00 already paid",
      res.error, "Total due can't be less than the $1,200.00 already paid. Enter $1,200.00 or more, or correct the payment history first.");
    assertEq("...and nothing is written", writes, []);
  }
  {
    const { res, writes } = await edit("0", { exempt: "true" });
    assertEq("marking exempt with $1,200 paid is rejected", res.ok, false);
    assertEq("...with the exemption-specific message", /Can't mark this player exempt/.test(res.error ?? ""), true);
    assertEq("...and nothing is written", writes, []);
  }

  /* ---------------- D. wiring that rendering alone can't reach ---------------- */
  console.log("D. wiring");
  const ui = fs.readFileSync(path.join(ROOT, "components", "FinanceClient.js"), "utf8");
  assertEq("the Save button reads the shared rule and nothing else",
    /<button type="submit" className="btn btn-primary" disabled=\{!canSave\}>/.test(ui), true);
  assertEq("an existing obligation is edited as one player, never as the bulk scope",
    /const effectiveScope = teamEdit \? "all" : isNew \? scope : "one";/.test(ui), true);
  assertEq("the rule compares against the obligation's current amount",
    /originalAmount: row\?\.totalDue \?\? null/.test(ui), true);
  assertEq("both PaymentForm call sites receive the page error so rejections show in the form",
    (ui.match(/formError=\{error\}/g) ?? []).length, 2);

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
