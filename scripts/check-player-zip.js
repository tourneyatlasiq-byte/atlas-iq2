/**
 * Player ZIP-assisted City/State, 2026-11.
 *
 * Behavioural checks, not source-text checks:
 *   A. lookupZipKey: 5-digit, ZIP+4, malformed
 *   B. pickZipMatch: what counts as a usable Geocodio answer
 *   C. the form reducer: Add, Edit, manual override, ZIP changes, stale answers
 *   D. the request controller: out-of-order responses, dedupe, failures
 *   E. lookupPlayerZip server action, with fetch and context stubbed: what is
 *      sent to Geocodio, what comes back, missing key, failures
 *   F. PlayerForm rendered (Add and Edit): fields, State list, preservation
 *   G. scope: who may call the ZIP lookup, and what it may send
 *
 * JSX/ESM compiled with the SWC that ships in Next.js. No network, no database.
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

const STUB_DIR = path.join(ROOT, "scripts", "__zip_stubs__");
const stubs = new Map();
const stub = (name, exportsObj) => stubs.set(name, exportsObj);
stub("next/cache", { revalidatePath() {} });
stub("next/headers", { cookies() { return { get() {}, set() {}, getAll() { return []; } }; }, headers() { return new Map(); } });
stub("next/navigation", {
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/team",
  redirect() { throw new Error("redirect"); },
  notFound() { throw new Error("notFound"); },
});
stub("next/link", { __esModule: true, default: (props) => require("react").createElement("a", props, props.children) });

const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const CONTEXT = path.join(ROOT, "lib", "context.js");
let role = "owner";
let contextThrows = false;

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (stubs.has(request)) return `${STUB_DIR}/${request}`;
  return origResolve.call(this, request, parent, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  const resolved = (() => { try { return Module._resolveFilename(request, parent); } catch { return null; } })();
  if (resolved === SUPABASE_SERVER) return { createClient: () => { throw new Error("no database in this check"); } };
  if (resolved === CONTEXT) {
    return {
      requireSeasonContext: async () => {
        if (contextThrows) throw new Error("No organization is linked to this account.");
        return { profile: { role }, organization: { id: "org-1" }, team: { id: "t" }, season: { id: "s" } };
      },
      getContext: async () => ({}),
      canWrite: (profile) => ["owner", "admin", "coach", "manager"].includes(profile?.role),
      isOrgAdmin: () => role === "owner",
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
  const src = fs.readFileSync(filename, "utf8");
  const { code } = swc.transformSync(src, { ...SWC_OPTS, filename });
  module._compile(code, filename);
};

const R = require(path.join(ROOT, "lib", "player-zip-rules.js"));
const { lookupZipKey, pickZipMatch, initZipForm, zipFormReducer, createZipLookupController } = R;

async function main() {
  /* ---------------- A. lookupZipKey ---------------- */
  console.log("A. ZIP parsing");
  assertEq("5-digit ZIP", lookupZipKey("30303"), "30303");
  assertEq("ZIP+4 with hyphen uses first five", lookupZipKey("30303-1234"), "30303");
  assertEq("ZIP+4 with space", lookupZipKey("30303 1234"), "30303");
  assertEq("ZIP+4 without separator", lookupZipKey("303031234"), "30303");
  assertEq("ZIP+4 still being typed keeps the same key", lookupZipKey("30303-12"), "30303");
  assertEq("surrounding spaces ignored", lookupZipKey("  30303 "), "30303");
  assertEq("leading zero kept", lookupZipKey("02134"), "02134");
  assertEq("4 digits: no lookup", lookupZipKey("3030"), null);
  assertEq("letters: no lookup", lookupZipKey("3030A"), null);
  assertEq("too long: no lookup", lookupZipKey("30303-12345"), null);
  assertEq("Canadian postcode: no lookup", lookupZipKey("K1A 0B1"), null);
  assertEq("blank / null: no lookup", [lookupZipKey(""), lookupZipKey(null), lookupZipKey(undefined)], [null, null, null]);

  /* ---------------- B. pickZipMatch ---------------- */
  console.log("B. usable answers");
  const atl = { zip: "30303", city: "Atlanta", state: "GA", accuracyType: "place" };
  assertEq("exact ZIP with city and state is a match", pickZipMatch([atl], "30303"), { zip: "30303", city: "Atlanta", state: "GA" });
  assertEq("a different ZIP is not a match", pickZipMatch([{ ...atl, zip: "30304" }], "30303"), null);
  assertEq("first usable candidate wins", pickZipMatch([{ ...atl, zip: "30304" }, atl], "30303"), { zip: "30303", city: "Atlanta", state: "GA" });
  assertEq("an unrecognised state is not a match", pickZipMatch([{ ...atl, state: "ZZ" }], "30303"), null);
  assertEq("a lower-case state is standardised", pickZipMatch([{ ...atl, state: "ga" }], "30303").state, "GA");
  assertEq("no city is not a match", pickZipMatch([{ ...atl, city: null }], "30303"), null);
  assertEq("no candidates is not a match", [pickZipMatch([], "30303"), pickZipMatch(null, "30303")], [null, null]);

  /* ---------------- C. reducer ---------------- */
  console.log("C. form rules");
  const run = (form, ...actions) => actions.reduce(zipFormReducer, form);
  const zipTo = (v) => ({ type: "zip", value: v });
  const answer = (key, extra = {}) => ({ type: "result", key, result: { status: "match", zip: key, city: "Atlanta", state: "GA", ...extra } });
  const dec = { type: "result", key: "30030", result: { status: "match", zip: "30030", city: "Decatur", state: "GA" } };
  const vals = (f) => [f.city.value, f.state.value, f.zip];

  {
    const f = run(initZipForm({}), zipTo("30303"), { type: "looking", key: "30303" });
    assertEq("Add: looking shows while the lookup runs", f.status, "looking");
    const g = zipFormReducer(f, answer("30303"));
    assertEq("Add: blank City and State are filled", vals(g), ["Atlanta", "GA", "30303"]);
    assertEq("Add: no suggestion when it filled them", g.suggestion, null);
    assertEq("Add: status back to idle", g.status, "idle");
    const h = run(g, zipTo("30030"), dec);
    assertEq("ZIP change refreshes values a previous lookup filled", vals(h), ["Decatur", "GA", "30030"]);
  }
  {
    const f = run(initZipForm({}), zipTo("30303"), answer("30303"), { type: "city", value: "Midtown" }, zipTo("30030"), dec);
    assertEq("manual City edit is never overwritten", f.city.value, "Midtown");
    assertEq("...the untouched automatic State is refreshed", f.state.value, "GA");
    assertEq("...and the result is offered instead", f.suggestion, { city: "Decatur", state: "GA", zip: "30030" });
    const accepted = zipFormReducer(f, { type: "acceptSuggestion" });
    assertEq("accepting the suggestion applies City and State", vals(accepted), ["Decatur", "GA", "30030"]);
    assertEq("...and makes them automatic again (a later ZIP may refresh them)",
      vals(run(accepted, zipTo("30303"), answer("30303"))), ["Atlanta", "GA", "30303"]);
    const kept = zipFormReducer(f, { type: "dismissSuggestion" });
    assertEq("Keep mine leaves the coach's values and hides the suggestion", [kept.city.value, kept.suggestion], ["Midtown", null]);
  }
  {
    const f = run(initZipForm({}), { type: "state", value: "TN" }, zipTo("30303"), answer("30303"));
    assertEq("a manual State with blank City: City filled, State kept", vals(f), ["Atlanta", "TN", "30303"]);
    assertEq("...and Atlanta, GA is suggested", f.suggestion, { city: "Atlanta", state: "GA", zip: "30303" });
    assertEq("typing the suggested value yourself hides the suggestion",
      zipFormReducer(f, { type: "state", value: "GA" }).suggestion, null);
  }
  {
    const saved = { street_address: "12 Elm St", street_address_2: "Apt 4", city: "Atlanta", state: "GA", zip: "30303" };
    const f = run(initZipForm(saved), zipTo("30030"), dec);
    assertEq("Edit: an existing address is never overwritten", vals(f), ["Atlanta", "GA", "30030"]);
    assertEq("Edit: ...the new result is suggested instead", f.suggestion, { city: "Decatur", state: "GA", zip: "30030" });
    const same = run(initZipForm(saved), zipTo("30303-1234"));
    assertEq("Edit: adding +4 to the saved ZIP changes nothing else", [vals(same), same.status], [["Atlanta", "GA", "30303-1234"], "idle"]);
    const agree = run(initZipForm({ ...saved, zip: "" }), zipTo("30303"), answer("30303"));
    assertEq("Edit: a result that agrees with the saved address is silent", [vals(agree), agree.suggestion], [["Atlanta", "GA", "30303"], null]);
    assertEq("form state never carries address lines", Object.keys(f).sort(), ["city", "state", "status", "suggestion", "zip"]);
  }
  {
    const f = run(initZipForm({}), zipTo("30303"), zipTo("30030"), answer("30303"));
    assertEq("stale: an answer for a ZIP no longer in the field is ignored", vals(f), ["", "", "30030"]);
    assertEq("stale: a looking signal for an old ZIP is ignored",
      run(initZipForm({}), zipTo("30030"), { type: "looking", key: "30303" }).status, "idle");
    assertEq("stale: the answer for the current ZIP still applies", vals(zipFormReducer(f, dec)), ["Decatur", "GA", "30030"]);
    assertEq("an answer whose ZIP differs from the request is ignored as no match",
      run(initZipForm({}), zipTo("30303"), answer("30303", { zip: "30304" })).city.value, "");
  }
  {
    const nm = run(initZipForm({}), zipTo("00000"), { type: "result", key: "00000", result: { status: "no_match" } });
    assertEq("no match: quiet note, fields untouched", [nm.status, vals(nm)], ["no_match", ["", "", "00000"]]);
    const down = run(initZipForm({}), zipTo("30303"), { type: "result", key: "30303", result: { status: "unavailable" } });
    assertEq("failure / missing key: quiet note, fields untouched", [down.status, vals(down)], ["unavailable", ["", "", "30303"]]);
    const junk = run(initZipForm({}), zipTo("30303"), { type: "result", key: "30303", result: null });
    assertEq("a malformed response is treated as unavailable", junk.status, "unavailable");
    const typed = run(down, { type: "city", value: "Atlanta" }, { type: "state", value: "GA" });
    assertEq("after a failure the coach can still type City and State", vals(typed), ["Atlanta", "GA", "30303"]);
  }
  {
    const withSug = run(initZipForm({ city: "Midtown", state: "GA" }), zipTo("30030"), dec);
    const bad = zipFormReducer(withSug, zipTo("3003"));
    assertEq("malformed ZIP clears the suggestion and keeps City/State", [bad.suggestion, bad.city.value, bad.state.value], [null, "Midtown", "GA"]);
    const cleared = run(initZipForm({}), zipTo("30303"), answer("30303"), zipTo(""));
    assertEq("clearing the ZIP leaves the filled City and State in place", vals(cleared), ["Atlanta", "GA", ""]);
    assertEq("an unknown action leaves the form alone", zipFormReducer(withSug, { type: "nope" }), withSug);
  }

  /* ---------------- D. controller ---------------- */
  console.log("D. request control");
  {
    const calls = [];
    const pending = {};
    const lookup = (zip) => { calls.push(zip); return new Promise((res) => { pending[zip] = res; }); };
    const got = [];
    const c = createZipLookupController(lookup);
    c.request("30303", (k, r) => got.push([k, r.status]));
    c.request("30030", (k, r) => got.push([k, r.status]));
    await new Promise((r) => setTimeout(r, 0));
    pending["30030"]({ status: "match" });
    pending["30303"]({ status: "match" });
    await new Promise((r) => setTimeout(r, 0));
    assertEq("out-of-order: both requested", calls, ["30303", "30030"]);
    assertEq("out-of-order: only the newest answer is delivered", got, [["30030", "match"]]);
  }
  {
    const calls = [];
    const c = createZipLookupController(async (z) => { calls.push(z); return { status: "match" }; });
    c.request("30303", () => {});
    c.request("30303-1234", () => {});
    c.request("30303-12", () => {});
    await new Promise((r) => setTimeout(r, 0));
    assertEq("ZIP and ZIP+4 of the same ZIP cost one lookup", calls, ["30303"]);
  }
  {
    const calls = [];
    const c = createZipLookupController(async (z) => { calls.push(z); return {}; }, "30303");
    assertEq("Edit: the saved ZIP is not looked up on open or re-entry", c.request("30303", () => {}).started, false);
    assertEq("malformed ZIP starts nothing", c.request("303", () => {}).started, false);
    await new Promise((r) => setTimeout(r, 0));
    assertEq("...no calls made", calls, []);
  }
  {
    const got = [];
    const c = createZipLookupController(async () => { throw new Error("network"); });
    c.request("30303", (k, r) => got.push(r.status));
    await new Promise((r) => setTimeout(r, 0));
    assertEq("a rejected lookup is reported as unavailable", got, ["unavailable"]);
  }
  {
    let res;
    const got = [];
    const c = createZipLookupController(() => new Promise((r) => { res = r; }));
    c.request("30303", (k) => got.push(k));
    await new Promise((r) => setTimeout(r, 0));
    c.request("3030", () => {});
    res({ status: "match" });
    await new Promise((r) => setTimeout(r, 0));
    assertEq("editing to a malformed ZIP drops the in-flight answer", got, []);
    const d = createZipLookupController(() => new Promise((r) => { res = r; }));
    d.request("30303", (k) => got.push(k));
    await new Promise((r) => setTimeout(r, 0));
    d.cancel();
    res({ status: "match" });
    await new Promise((r) => setTimeout(r, 0));
    assertEq("closing the form drops the in-flight answer", got, []);
  }

  /* ---------------- E. server action ---------------- */
  console.log("E. lookupPlayerZip");
  const { lookupPlayerZip } = require(path.join(ROOT, "lib", "actions", "player-address.js"));
  const FAKE_KEY = "test_key_must_never_leave_the_server";
  const sent = [];
  let reply = null;
  global.fetch = async (url, init) => {
    sent.push({ url: String(url), auth: init?.headers?.Authorization });
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const geo = (zip, city, state) => ({ results: [{
    address_components: { city, state_province: state, postal_code: zip, county: "Fulton County", number: null },
    accuracy: 1, accuracy_type: "place", location: { lat: 33.7, lng: -84.4 }, stable_address_key: "abc",
  }] });

  process.env.GEOCODIO_API_KEY = FAKE_KEY;
  reply = ok(geo("30303", "Atlanta", "GA"));
  sent.length = 0;
  const m = await lookupPlayerZip("30303-1234");
  assertEq("ZIP+4 returns the five-digit match", m, { status: "match", zip: "30303", city: "Atlanta", state: "GA" });
  const u = new URL(sent[0].url);
  assertEq("one request, to Geocodio v2", [sent.length, u.origin + u.pathname], [1, "https://api.geocod.io/v2/geocode"]);
  assertEq("the request carries only the five-digit ZIP and country", [...u.searchParams.entries()], [["postal_code", "30303"], ["country", "USA"]]);
  assertEq("the key travels in the Authorization header only", [sent[0].auth, sent[0].url.includes(FAKE_KEY)], [`Bearer ${FAKE_KEY}`, false]);
  assertEq("the result carries no key, coordinates or vendor ids", JSON.stringify(m).match(/test_key|lat|lng|stable|county/), null);

  sent.length = 0;
  assertEq("malformed ZIP: invalid, nothing sent", [await lookupPlayerZip("3030A"), sent.length], [{ status: "invalid" }, 0]);
  assertEq("non-string input (an object with player data): invalid, nothing sent",
    [await lookupPlayerZip({ zip: "30303", full_name: "Avery Rowley", street_address: "12 Elm St" }), sent.length], [{ status: "invalid" }, 0]);

  reply = ok(geo("30304", "Atlanta", "GA"));
  assertEq("a returned ZIP that differs from the request: no match", await lookupPlayerZip("30303"), { status: "no_match" });
  reply = ok({ results: [] });
  assertEq("no results: no match", await lookupPlayerZip("00000"), { status: "no_match" });
  reply = { ok: false, status: 500, json: async () => ({ error: `bad ${FAKE_KEY}` }) };
  const failedReply = await lookupPlayerZip("30303");
  assertEq("HTTP failure: unavailable, vendor error not echoed", failedReply, { status: "unavailable" });
  reply = new Error("ECONNRESET");
  assertEq("network failure: unavailable", await lookupPlayerZip("30303"), { status: "unavailable" });
  reply = { ok: true, status: 200, json: async () => { throw new Error("not json"); } };
  assertEq("unreadable response: unavailable", await lookupPlayerZip("30303"), { status: "unavailable" });

  delete process.env.GEOCODIO_API_KEY;
  sent.length = 0;
  reply = ok(geo("30303", "Atlanta", "GA"));
  assertEq("missing key: unavailable, nothing sent", [await lookupPlayerZip("30303"), sent.length], [{ status: "unavailable" }, 0]);
  process.env.GEOCODIO_API_KEY = FAKE_KEY;

  role = "parent";
  sent.length = 0;
  assertEq("a role that cannot edit the roster: unavailable, nothing sent", [await lookupPlayerZip("30303"), sent.length], [{ status: "unavailable" }, 0]);
  role = "coach";
  assertEq("coach can look up", (await lookupPlayerZip("30303")).status, "match");
  role = "owner";
  contextThrows = true;
  sent.length = 0;
  assertEq("no signed-in context: unavailable, nothing sent", [await lookupPlayerZip("30303"), sent.length], [{ status: "unavailable" }, 0]);
  contextThrows = false;

  /* ---------------- F. PlayerForm rendered ---------------- */
  console.log("F. PlayerForm");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const consoleError = console.error;
  console.error = (msg, ...rest) => {
    if (typeof msg === "string" && msg.includes("Invalid value for prop") && rest.includes("`action`")) return;
    consoleError(msg, ...rest);
  };
  const { PlayerForm } = require(path.join(ROOT, "components", "RosterClient.js"));
  const noop = () => {};
  const render = (row) => renderToStaticMarkup(React.createElement(PlayerForm, { row, pending: false, onSubmit: noop, onCancel: noop }));
  const rowFor = (player) => ({ id: "a1", is_active: true, positions: [], player: { id: "p1", full_name: "Avery Rowley", person_type: "player", ...player } });
  const selected = (html) => (html.match(/<select id="state"[^>]*>([\s\S]*?)<\/select>/)?.[1].match(/<option value="([^"]*)" selected=""/) ?? [])[1] ?? null;

  const add = render(null);
  assertEq("Add: City, State and ZIP keep their field names", [/name="city"/.test(add), /<select id="state" name="state"/.test(add), /name="zip"/.test(add)], [true, true, true]);
  const { US_STATES } = require(path.join(ROOT, "lib", "facility-fields.js"));
  assertEq("Add: State is the same list Facilities uses, plus a placeholder",
    (add.match(/<select id="state"[\s\S]*?<\/select>/)[0].match(/<option /g) || []).length, Object.keys(US_STATES).length + 1);
  assertEq("Add: State starts unselected", selected(add), "");
  assertEq("Add: ZIP keeps the numeric mobile keyboard and postal-code autofill",
    /<input id="zip" name="zip" autoComplete="postal-code" inputMode="numeric"/.test(add), true);
  assertEq("Add: Address line 1 and 2 still present, unchanged", [/name="street_address" autoComplete="address-line1"/.test(add), /name="street_address_2" autoComplete="address-line2"/.test(add)], [true, true]);
  assertEq("Add: no Check address button on the Player form", /Check address/.test(add), false);
  assertEq("Add: the lookup adds no required/pattern rule that could block saving",
    /<input id="(city|zip)"[^>]*(required|pattern)/.test(add) || /<select id="state"[^>]*required/.test(add), false);
  const submit = add.match(/<button type="submit"[^>]*>/)?.[0] ?? "";
  assertEq("Add: Save is not disabled by anything address-related", /disabled/.test(submit), false);

  const edit = render(rowFor({ street_address: "12 Elm St", street_address_2: "Apt 4", city: "Atlanta", state: "GA", zip: "30303" }));
  assertEq("Edit: saved City and ZIP shown", [/id="city"[^>]*value="Atlanta"/.test(edit), /id="zip"[^>]*value="30303"/.test(edit)], [true, true]);
  assertEq("Edit: saved GA is selected", selected(edit), "GA");
  assertEq("Edit: address lines shown as saved", [/value="12 Elm St"/.test(edit), /value="Apt 4"/.test(edit)], [true, true]);
  const legacy = render(rowFor({ state: "Georgia" }));
  assertEq("Edit: a non-standard saved State is kept and selected exactly as stored", selected(legacy), "Georgia");
  const lower = render(rowFor({ state: "ga" }));
  assertEq("Edit: lower-case 'ga' is preserved, not rewritten on open", selected(lower), "ga");
  assertEq("Edit: every saved State is a selectable option, so Save can never blank it",
    ["GA", "Georgia", "ga", " TN", "Ontario"].every((st) => selected(render(rowFor({ state: st }))) === st), true);
  assertEq("Edit: blank saved State selects the placeholder", selected(render(rowFor({ state: null }))), "");
  const staff = render(rowFor({ person_type: "coach" }));
  assertEq("Staff: no mailing address or ZIP lookup fields (unchanged)", /name="zip"/.test(staff), false);

  /* ---------------- G. scope ---------------- */
  console.log("G. scope");
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? (d.name === "node_modules" || d.name.startsWith(".") ? [] : walk(path.join(dir, d.name))) : d.name.endsWith(".js") ? [path.join(dir, d.name)] : []);
  const src = [...walk("app"), ...walk("components"), ...walk("lib")];
  const users = (re) => src.filter((f) => re.test(read(f))).sort();
  assertEq("geocodePostalCode is used only by the Player ZIP action",
    users(/geocodePostalCode/).filter((f) => f !== path.join("lib", "geocoding", "geocodio.js")), [path.join("lib", "actions", "player-address.js")]);
  assertEq("lookupPlayerZip is used only by the Player City/State/ZIP fields",
    users(/lookupPlayerZip/).filter((f) => f !== path.join("lib", "actions", "player-address.js")), [path.join("components", "PlayerCityStateZip.js")]);
  assertEq("PlayerCityStateZip is mounted only in RosterClient (the shared PlayerForm)",
    users(/PlayerCityStateZip/).filter((f) => f !== path.join("components", "PlayerCityStateZip.js")), [path.join("components", "RosterClient.js")]);
  assertEq("imports, intake, exports and Facilities do not use the ZIP lookup",
    users(/lookupPlayerZip|geocodePostalCode|player-zip-rules/).filter((f) => /intake|Import|Export|export|Facilit|QuickAdd|facilit/.test(f)), []);
  const zipFn = read("lib/geocoding/geocodio.js").split("export async function geocodePostalCode")[1];
  assertEq("geocodePostalCode builds its URL from the ZIP and country only",
    (zipFn.match(/const url = `([^`]*)`/) || [])[1], "${GEOCODIO_BASE}?postal_code=${zip5}&country=USA");
  assertEq("the Geocodio boundary logs nothing", /console\./.test(read("lib/geocoding/geocodio.js") + read("lib/actions/player-address.js")), false);
  assertEq("roster save still reads city, state and zip exactly as before",
    ["city", "state", "zip"].every((k) => read("lib/actions/roster.js").includes(`${k}: text(formData.get("${k}"))`)), true);
  assertEq("Privacy Policy discloses Geocodio for facilities and ZIP-only for players",
    /name: "Geocodio"/.test(read("lib/legal.js")) && /only the ZIP code is sent/.test(read("lib/legal.js")), true);

  console.log(`\nPlayer ZIP: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
