/**
 * Direct entry into a tournament task, on the real Tournaments screen (2026-11).
 * Server actions and the router are stood in for; the component is real.
 *   venue    opens Edit with the facility picker already open; cancel returns to Locations
 *   resource opens the link picker; cancel returns
 *   contact  opens the drawer with the contact section open; closing returns
 *   no task, or a read-only user, behaves as before
 */
const path = require("path"), fs = require("fs"), Module = require("module");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
const ok = (label, cond, extra = "") => { if (cond) passed++; else failed++; console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : `\n        ${extra}`}`); };

let query = "";            // current address query, mutable per scenario
const nav = { pushes: [], replaces: [] };
const stubNav = {
  useRouter: () => ({
    push: (u) => { nav.pushes.push(u); }, replace: (u) => { nav.replaces.push(u); const q = String(u).split("?")[1] ?? ""; query = q; }, refresh() {}, back() {},
  }),
  usePathname: () => "/tournaments",
  useSearchParams: () => new URLSearchParams(query),
};
const stubLink = { __esModule: true, default: (p) => require("react").createElement("a", { href: p.href, className: p.className }, p.children) };
const SUPA = path.join(ROOT, "lib", "supabase", "server.js"), CTX = path.join(ROOT, "lib", "context.js");
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/navigation") return stubNav;
  if (request === "next/link") return stubLink;
  if (request === "next/cache") return { revalidatePath() {} };
  let resolved = null; try { resolved = origResolve.call(Module, request, parent); } catch {}
  if (resolved && (resolved === SUPA || resolved === CTX || resolved.includes(`${path.sep}lib${path.sep}actions${path.sep}`))) {
    return new Proxy({ __esModule: true }, { get: (t, k) => (k in t ? t[k] : async () => ({ ok: true })) });
  }
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "http://localhost/tournaments" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "KeyboardEvent"]) {
  try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch {}
}
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const _err = console.error; console.error = (...a) => { if (!/Invalid value for prop|not wrapped in act/.test(a.join(" "))) _err(...a); };
const React = require("react"), { act } = React, { createRoot } = require("react-dom/client");
const { ToastProvider } = require(path.join(ROOT, "components", "Toaster.js"));
const { TournamentClient } = require(path.join(ROOT, "components", "TournamentClient.js"));

const T1 = { id: "t1", name: "Fall Kickoff", decision: "Committed", paid_status: "Registered", start_date: "2099-03-06", end_date: "2099-03-08", entry_fee: 400, gate_fee: 0, total_cost: 400, facility: null, provider: null, contact_id: null, notes: null };
const FACS = [{ id: "f1", name: "Riverside Park", city: "Aurora", state: "IL", type: "facility" }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const props = (o = {}) => ({ tournaments: [T1], actions: [], summary: {}, record: {}, providers: [], facilities: FACS, canWrite: true, documentTargets: [], seasonName: "Fall 2026", participants: {}, seasonRoster: [], pickupCandidates: [], contacts: [], budgetLines: [], transactions: [], serverToday: "2099-01-01", ...o });
async function mount(q, p = props()) {
  query = q; nav.pushes.length = 0; nav.replaces.length = 0;
  document.body.innerHTML = "<div id=root></div>";
  const root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(React.createElement(ToastProvider, null, React.createElement(TournamentClient, p))); });
  await act(async () => { await sleep(30); });
  return root;
}
const unmount = async (root) => { await act(async () => { root.unmount(); }); };
const txt = () => document.body.textContent;
const btn = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent));
const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); await act(async () => { await sleep(20); }); };

(async () => {
  console.log("A. venue: picker already open");
  let r = await mount("open=t1&action=venue&return=%2Ffacilities%3Fq%3Dpark");
  ok("Edit form is open", /Choose a facility/.test(txt()) || !!document.querySelector("form"), txt().slice(0, 200));
  ok("the facility picker is already open", /Choose a facility/.test(txt()), txt().slice(0, 300));
  ok("the task is dropped from the address, ?open kept", nav.replaces.some((u) => /open=t1/.test(u) && !/action=/.test(u) && !/return=/.test(u)), JSON.stringify(nav.replaces));
  const cancel = [...document.querySelectorAll("button")].filter((b) => /^Cancel$/.test(b.textContent.trim()));
  ok("a Cancel exists", cancel.length > 0);
  await click(cancel[cancel.length - 1]); // ONE Cancel, on the picker
  ok("one Cancel closes the picker and the form", !/Choose a facility/.test(txt()) && !/Edit tournament|Save changes/.test(txt()), txt().slice(0, 120));
  ok("cancelling returns to Locations with the starting query", nav.pushes.includes("/facilities?q=park"), JSON.stringify(nav.pushes));
  await unmount(r);

  console.log("B. resource: link picker open, cancel returns");
  r = await mount("open=t1&action=resource&return=%2Ffacilities");
  ok("the link picker is open", /Link a location or resource/.test(txt()), txt().slice(0, 200));
  await click([...document.querySelectorAll("button")].filter((b) => /^Cancel$|^Close$/.test(b.textContent.trim())).pop());
  ok("cancel returns to Locations", nav.pushes.includes("/facilities"), JSON.stringify(nav.pushes));
  await unmount(r);

  console.log("C. contact: drawer with the contact section open");
  r = await mount("open=t1&action=contact&return=%2Ffacilities");
  ok("the drawer is open on the tournament", /Fall Kickoff/.test(txt()));
  const sec = document.getElementById("section-contact");
  const head = sec?.querySelector("[aria-expanded]");
  ok("the contact section is open", head?.getAttribute("aria-expanded") === "true", sec?.outerHTML?.slice(0, 200));
  const other = document.getElementById("section-costs")?.querySelector("[aria-expanded]");
  ok("other sections keep their own state", other?.getAttribute("aria-expanded") !== "true", other?.outerHTML?.slice(0, 120));
  await unmount(r);

  console.log("D. no task: nothing extra opens");
  r = await mount("open=t1");
  ok("no picker", !/Choose a facility|Link a location or resource/.test(txt()));
  ok("no navigation away", nav.pushes.length === 0 && nav.replaces.length === 0, JSON.stringify(nav));
  await unmount(r);

  console.log("E. unsafe return is ignored");
  r = await mount("open=t1&action=resource&return=https%3A%2F%2Fevil.example");
  await click([...document.querySelectorAll("button")].filter((b) => /^Cancel$|^Close$/.test(b.textContent.trim())).pop());
  ok("never navigates to the outside address", !nav.pushes.some((u) => /evil/.test(u)), JSON.stringify(nav.pushes));
  await unmount(r);

  console.log("F. read-only user does not get an editor");
  r = await mount("open=t1&action=venue&return=%2Ffacilities", props({ canWrite: false }));
  ok("no facility picker for read-only", !/Choose a facility/.test(txt()));
  await unmount(r);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
