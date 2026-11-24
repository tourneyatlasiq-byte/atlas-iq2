/**
 * Parent Details and the Stay-to-Play travel type (2026-11).
 *
 * Scope, exactly: ONE optional text field on a tournament (parent_details),
 * ONE new travel type (Stay-to-Play), and ONE option on the existing Tournament
 * Schedule report that includes the field. No hotel table, no second report.
 *
 *   A. the report payload: what can and cannot reach the parent document
 *   B. the document, rendered: Stay-to-Play marker, Parent Details block, the
 *      single option, and the "nothing there, nothing shown" rules
 *   C. the drawer, the form and the server action
 *   D. the migration file and the build guard
 *
 * Same harness as check-schedule-report.js: SWC from Next.js compiles on the
 * fly; no network or database.
 * Run: node scripts/check-parent-details.js
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
let n = 0, bad = 0;
function eq(label, actual, expected = true) {
  n++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const src = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

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

/** In-memory database that honours eq / in and records every select string. */
function fakeDb(tables) {
  const selects = [];
  return {
    selects,
    from(table) {
      const filters = [];
      let one = false;
      const run = () => {
        const rows = (tables[table] ?? []).filter((r) => filters.every(([k, op, v]) => (op === "eq" ? r[k] === v : v.includes(r[k]))));
        return { data: one ? rows[0] ?? null : rows, error: null };
      };
      const b = {
        select(s) { selects.push({ table, select: s }); return b; },
        eq(k, v) { filters.push([k, "eq", v]); return b; },
        in(k, v) { filters.push([k, "in", v]); return b; },
        maybeSingle() { one = true; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
  };
}

const iso = (d) => d.toISOString().slice(0, 10);
const day = (k) => iso(new Date(Date.now() + k * 86400000));
const S = "season-1";
const base = { season_id: S, location: null, facility: null, paid_status: "Registered", entry_fee: 500, gate_fee: 40, notes: "INTERNAL PLAN: swap pitchers" };
const tournaments = [
  { ...base, id: "stay", name: "Peach State Showdown", decision: "Committed", start_date: day(10), end_date: day(12), travel_type: "Stay-to-Play",
    parent_details: "  Book through the tournament hotel block by Oct 1.\nCode: PEACH26  " },
  { ...base, id: "over", name: "Red Clay Classic", decision: "Committed", start_date: day(20), end_date: day(21), travel_type: "Overnight", parent_details: null },
  { ...base, id: "ext", name: "Gulf Coast Classic", decision: "Considering", start_date: day(30), end_date: day(33), travel_type: "Extended Stay", parent_details: "   " },
  { ...base, id: "day", name: "Local Slam", decision: "Committed", start_date: day(40), end_date: day(40), travel_type: "Day Trip", parent_details: "Gate opens at 7 AM. <script>alert(1)</script>" },
  { ...base, id: "none", name: "No Travel Set", decision: "Committed", start_date: day(50), end_date: day(51), travel_type: null, parent_details: undefined },
  { ...base, id: "declined", name: "Declined Cup", decision: "Declined", start_date: day(15), end_date: day(16), travel_type: "Stay-to-Play", parent_details: "NEVER PRINT THIS" },
];
const season = { id: S, name: "2026-27", team: { id: "t", name: "Bramblewood 14U Gold", organization: { id: "o", name: "Bramblewood Fastpitch", logo_url: null } } };

(async () => {
  const { tournamentScheduleReport } = require(path.join(ROOT, "lib", "queries", "reports", "tournament-schedule.js"));
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { TournamentScheduleReport } = require(path.join(ROOT, "components", "reports", "TournamentScheduleReport.js"));

  console.log("\nA. the report payload\n");
  db = fakeDb({ seasons: [season], tournaments, games: [] });
  const report = await tournamentScheduleReport(S);
  const by = Object.fromEntries(report.tournaments.map((t) => [t.id, t]));
  const json = JSON.stringify(report);

  eq("only Stay-to-Play is marked stayToPlay", report.tournaments.map((t) => [t.id, t.stayToPlay]),
    [["stay", true], ["over", false], ["ext", false], ["day", false], ["none", false]]);
  eq("the other travel types never reach the document", ["Overnight", "Extended Stay", "Day Trip", "travel_type"].filter((w) => json.includes(w)), []);
  eq("Parent Details are trimmed and keep their line break", by.stay.parentDetails, "Book through the tournament hotel block by Oct 1.\nCode: PEACH26");
  eq("blank, whitespace-only and missing Parent Details are all null", [by.over.parentDetails, by.ext.parentDetails, by.none.parentDetails], [null, null, null]);
  eq("planning notes never reach the payload", [json.includes("INTERNAL PLAN"), /"notes"/.test(json)], [false, false]);
  eq("costs and registration never reach the payload", [json.includes("entry_fee"), json.includes("gate_fee"), /500|"Registered"|paid_status/.test(json)], [false, false, false]);
  eq("a Declined tournament's Parent Details are never fetched into the document", json.includes("NEVER PRINT THIS"), false);
  eq("the row carries exactly the allowlisted fields",
    report.tournaments.every((t) => Object.keys(t).sort().join() === "endDate,games,id,name,parentDetails,place,startDate,status,stayToPlay,waitlisted"), true);
  const tSelect = db.selects.find((s) => s.table === "tournaments").select;
  eq("the query selects parent_details and travel_type, and still never notes or fees",
    [/parent_details/.test(tSelect), /travel_type/.test(tSelect), /\bnotes\b/.test(tSelect), /entry_fee|gate_fee|total_cost/.test(tSelect)], [true, true, false, false]);

  console.log("\nB. the document, rendered\n");
  const render = (r, opts = {}) => renderToStaticMarkup(React.createElement(TournamentScheduleReport, { report: r, ...opts }));
  const count = (html, re) => (html.match(re) ?? []).length;
  const html = render(report);
  const doc = html.slice(html.indexOf("<article"));

  eq("Stay-to-Play is labelled on its own tournament and no other", count(doc, /class="sch-tag">Stay-to-Play</g), 1);
  eq("the label sits in the status column of the Stay-to-Play tournament",
    /class="sch-when"><p class="sch-date">[^<]*<\/p><p class="sch-status[^"]*">Committed<\/p><p class="sch-tag">Stay-to-Play<\/p><\/div>/.test(doc), true);
  eq("Parent Details print under each tournament that has them (two here), with a label, text and line breaks intact",
    [count(doc, /class="sch-parent"/g), /<p class="sch-parent-label">Parent details<\/p>/.test(doc), /Book through the tournament hotel block by Oct 1\.\nCode: PEACH26/.test(doc)], [2, true, true]);
  eq("they print for the tournament that has some, and a tournament with none gets no empty section",
    [count(doc, /class="sch-parent-label"/g), /Gate opens at 7 AM\./.test(doc)], [2, true]);
  eq("Parent Details text is escaped, never markup", [doc.includes("<script>"), doc.includes("&lt;script&gt;alert(1)&lt;/script&gt;")], [false, true]);
  eq("Parent Details sit inside the heading block, so they stay with the tournament on a page break",
    /<div class="sch-keep"><div class="sch-heading">[\s\S]*?<\/div><div class="sch-parent">/.test(doc), true);
  eq("planning notes and costs are not in the document", [/INTERNAL PLAN|swap pitchers/.test(doc), /\$|500|entry|gate fee/i.test(doc)], [false, false]);
  eq("a Declined tournament's Stay-to-Play and Parent Details do not appear", [doc.includes("NEVER PRINT THIS"), doc.includes("Declined")], [false, false]);

  console.log("\nB2. the single option\n");
  const toolbar = html.slice(0, html.indexOf("<article"));
  eq("exactly one new control: Include Parent Details, on by default when any tournament has Parent Details",
    [...toolbar.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`),
    ["Tournaments only:true", "Include game schedule:false", "Include Parent Details:true"]);
  const off = render(report, { initialParents: false });
  const offDoc = off.slice(off.indexOf("<article"));
  eq("switched off: no Parent Details anywhere in the document", [/sch-parent/.test(offDoc), offDoc.includes("PEACH26"), offDoc.includes("Gate opens")], [false, false, false]);
  eq("switched off: Stay-to-Play is still labelled (it is a fact about the tournament, not a detail)", count(offDoc, /class="sch-tag">Stay-to-Play</g), 1);
  eq("switched off: the control reads not pressed", /aria-pressed="false"[^>]*>Include Parent Details</.test(off), true);
  eq("the choice is screen-only (inside the no-print toolbar)", /<div class="rpt-bar rpt-no-print">[\s\S]*Include Parent Details[\s\S]*<article/.test(html), true);
  eq("it works with the game schedule version too",
    (() => { const g = render(report, { initialDetail: "games" }); return [/sch-parent/.test(g), /Include Parent Details/.test(g), count(g.slice(g.indexOf("<article")), /class="sch-tag">Stay-to-Play</g)]; })(),
    [true, true, 1]);

  console.log("\nB3. nothing entered, nothing changes\n");
  const plain = { ...report, tournaments: report.tournaments.map((t) => ({ ...t, parentDetails: null, stayToPlay: false })) };
  const plainHtml = render(plain);
  eq("no Parent Details and no Stay-to-Play: no tag, no section, no option",
    [/sch-tag|sch-parent|Parent details|Stay-to-Play|Include Parent Details/.test(plainHtml)], [false]);
  eq("...and the toolbar is exactly the two existing choices",
    [...plainHtml.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`), ["Tournaments only:true", "Include game schedule:false"]);
  const stayOnly = { ...plain, tournaments: plain.tournaments.map((t) => (t.id === "stay" ? { ...t, stayToPlay: true } : t)) };
  eq("Stay-to-Play without Parent Details: labelled, and no Parent Details option is offered",
    [count(render(stayOnly), /class="sch-tag">Stay-to-Play</g), /Include Parent Details/.test(render(stayOnly))], [1, false]);
  eq("the legend, footer and status labels are untouched",
    [/Tournament dates and game times can change\./.test(html), /2026-27 Tournament Schedule<\/h1>/.test(html)], [true, true]);

  console.log("\nB4. print and phone styling\n");
  const css = src("app", "reports", "tournament-schedule", "schedule.css");
  const rule = (sel) => (css.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`)) ?? [])[1] ?? "";
  eq("the Stay-to-Play label is a bordered, bold word: readable in black and white with backgrounds off",
    [/border:\s*1\.5px solid/.test(rule(".sch-tag")), /font-weight:\s*(800|900)/.test(rule(".sch-tag")), /color:/.test(rule(".sch-tag"))], [true, true, true]);
  eq("Parent Details keep line breaks and wrap long words and links", [/white-space:\s*pre-line/.test(rule(".sch-parent-text")), /overflow-wrap:\s*(anywhere|break-word)/.test(rule(".sch-parent-text"))], [true, true]);
  eq("Parent Details stay readable on paper (13px or more)", Number((rule(".sch-parent-text").match(/font-size:\s*([\d.]+)px/) ?? [])[1] ?? 0) >= 13, true);

  console.log("\nC. the page, the drawer, the form and the server\n");
  const page = src("app", "reports", "tournament-schedule", "page.js");
  const comp = src("components", "reports", "TournamentScheduleReport.js");
  eq("?parents=0 turns the option off; anything else leaves it on", /searchParams\?\.parents === "0" \? false : true|searchParams\?\.parents !== "0"/.test(page), true);
  eq("the option only updates this page's address, saves nothing", [/replaceState/.test(comp), /fetch\(|localStorage|sessionStorage|use server|supabase/.test(comp)], [true, false]);

  const tc = src("components", "TournamentClient.js");
  const q = src("lib", "queries", "tournaments.js");
  const act = src("lib", "actions", "tournaments.js");
  const rules = src("lib", "schedule-rules.js");
  const list = (s) => (s.match(/TRAVEL_TYPES = (\[[^\]]*\])/) ?? [])[1];
  eq("Stay-to-Play is a travel option, in the form and in the query module, with the same list",
    [list(tc), list(q)], ['["Day Trip", "Overnight", "Extended Stay", "Stay-to-Play"]', '["Day Trip", "Overnight", "Extended Stay", "Stay-to-Play"]']);
  eq("the Tournaments page loads parent_details with every tournament", /parent_details/.test((q.match(/export async function listSeasonTournaments[\s\S]*?\.select\(\s*`([\s\S]*?)`/) ?? [])[1] ?? ""), true);
  eq("the length limit is defined once and shared", [/export const PARENT_DETAILS_MAX = 2000;/.test(rules), /PARENT_DETAILS_MAX/.test(tc), /PARENT_DETAILS_MAX/.test(act)], [true, true, true]);
  eq("the server saves parent_details, separately from notes", [/parent_details: text\(formData\.get\("parent_details"\)\)/.test(act), /notes: text\(formData\.get\("notes"\)\)/.test(act)], [true, true]);
  eq("the server refuses over-long Parent Details instead of cutting them off",
    [(act.match(/PARENT_DETAILS_MAX/g) ?? []).length >= 3, /Parent Details can be up to/.test(act)], [true, true]);
  eq("add and edit both check it", [/async function addTournament[\s\S]*?parentDetailsError\(fields\)/.test(act), /async function updateTournament[\s\S]*?parentDetailsError\(fields\)/.test(act)], [true, true]);
  eq("the form has its own Parent details field: optional, capped, and not the Notes field",
    [/<textarea id="parent_details" name="parent_details"[^>]*maxLength=\{PARENT_DETAILS_MAX\}/.test(tc), /id="notes" name="notes"/.test(tc), /parent_details[\s\S]{0,400}required/.test(tc.slice(tc.indexOf('id="parent_details"'), tc.indexOf('id="parent_details"') + 400))], [true, true, false]);
  eq("the form says where the text goes and that Notes stay private", /Shown on the Tournament Schedule when you include it\. Notes are never printed\./.test(tc), true);
  eq("the drawer has a Parent details section after Notes, not mixed into it",
    [tc.indexOf('id="section-parent"') > tc.indexOf('id="section-notes"'), /\{t\.parent_details \?\?/.test(tc)], [true, true]);
  eq("Planning Notes still read exactly as before", /\{t\.notes \?\? <span className="muted">No notes yet\.<\/span>\}/.test(tc), true);

  console.log("\nC2. the real server actions, run against an in-memory database\n");
  {
    const actionSrc = src("lib", "actions", "tournaments.js");
    const body = actionSrc.replace(/^"use server";/m, "").replace(/^import .*$/gm, "").replace(/export async function/g, "async function")
      + "\nreturn { addTournament, updateTournament };";
    const calls = { updates: [], inserts: [] };
    const builder = () => {
      const q = {
        select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; },
        limit() { return Promise.resolve({ data: [] }); },
        insert(row) { calls.inserts.push(row); return q; },
        update(row) { calls.updates.push(row); return { eq: () => Promise.resolve({ error: null }) }; },
        single() { return Promise.resolve({ data: { id: "new-id" }, error: null }); },
      };
      return q;
    };
    // Fee parsing lives in lib/tournament-cost.js (moved unchanged); load the real source.
    const { feesFrom } = new Function(src("lib", "tournament-cost.js").replace(/export function/g, "function") + "\nreturn { feesFrom };")();
    // The date rule lives in lib/dates.js; load the real source, not a copy.
    const { dateRangeError } = new Function(src("lib", "dates.js").replace(/export (const|function)/g, "$1") + "\nreturn { dateRangeError };")();
    const { addTournament, updateTournament } = new Function("revalidatePath", "createClient", "requireSeasonContext", "canWrite", "isValidDecision", "isValidPaidStatus", "PARENT_DETAILS_MAX", "feesFrom", "dateRangeError", body)(
      () => {}, () => ({ from: () => builder() }), async () => ({ profile: {}, organization: { id: "org1" }, season: { id: "sea1" } }), () => true, () => true, () => true, 2000, feesFrom, dateRangeError);
    const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries({ id: "t1", name: "Peach State", start_date: "2027-06-11", ...o })) f.set(k, v); return f; };

    let r = await updateTournament(form({ parent_details: "  Hotel block closes Oct 1\nCode PEACH  ", notes: "private", travel_type: "Stay-to-Play" }));
    eq("saving writes trimmed Parent Details, Notes and Stay-to-Play as three separate fields",
      [r.ok, calls.updates.at(-1).parent_details, calls.updates.at(-1).notes, calls.updates.at(-1).travel_type], [true, "Hotel block closes Oct 1\nCode PEACH", "private", "Stay-to-Play"]);
    r = await updateTournament(form({ parent_details: "   " }));
    eq("blank Parent Details are stored as nothing (null), not as spaces", [r.ok, calls.updates.at(-1).parent_details], [true, null]);
    r = await updateTournament(form({ parent_details: "x".repeat(2000) }));
    eq("exactly 2,000 characters are accepted", [r.ok, calls.updates.at(-1).parent_details.length], [true, 2000]);
    const before = calls.updates.length;
    r = await updateTournament(form({ parent_details: "x".repeat(2001) }));
    eq("2,001 characters are refused with a clear message, and nothing is written",
      [r.ok, r.error, calls.updates.length], [false, "Parent Details can be up to 2,000 characters. This one is 2,001.", before]);
    r = await addTournament(form({ id: undefined, parent_details: "Gate opens at 7" }));
    eq("adding a tournament stores Parent Details too", [r.ok, calls.inserts.at(-1).parent_details], [true, "Gate opens at 7"]);
    const ins = calls.inserts.length;
    r = await addTournament(form({ id: undefined, parent_details: "y".repeat(2001) }));
    eq("adding refuses an over-long entry and inserts nothing", [r.ok, calls.inserts.length], [false, ins]);
    r = await updateTournament(form({}));
    eq("a save that never mentions Parent Details leaves it empty rather than failing", [r.ok, calls.updates.at(-1).parent_details], [true, null]);
  }

  console.log("\nD. the migration and the deploy guard\n");
  const dirs = ["supabase/migrations", "supabase/pending"].map((d) => path.join(ROOT, d));
  const file = dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).map((f) => path.join(d, f)) : [])).find((f) => /tournament_parent_details_stay_to_play\.sql$/.test(f));
  eq("the migration file exists in the repository", Boolean(file));
  const sql = file ? fs.readFileSync(file, "utf8").replace(/--.*$/gm, "") : "";
  eq("it adds one nullable text column and nothing else new",
    [/add column if not exists parent_details text\s*;/i.test(sql), (sql.match(/add column/gi) ?? []).length, /create\s+table|create\s+(or replace\s+)?function|create\s+policy|create\s+trigger|drop\s+(table|column|policy|trigger)/i.test(sql)], [true, 1, false]);
  eq("it keeps every existing travel type and adds Stay-to-Play",
    ["Day Trip", "Overnight", "Extended Stay", "Stay-to-Play"].every((w) => sql.includes(`'${w}'::text`)), true);
  eq("it touches no rows", /\b(update|delete|insert)\b/i.test(sql), false);
  eq("it only ever alters the tournaments table", [...sql.matchAll(/alter\s+table\s+([\w.]+)/gi)].every((m) => m[1] === "public.tournaments"), true);

  console.log(`\n${n} assertions, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
