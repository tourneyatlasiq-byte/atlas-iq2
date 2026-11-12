/**
 * Help & Getting Started V1 (2026-11).
 *
 * Behavioural where it can be: the real lib/help.js and lib/help-guides.js are
 * compiled and run, and the Help pages are rendered to HTML with React. Source
 * assertions cover the wiring that only exists in components.
 *
 *   A. Content shape: nine guides, short steps, unique anchors
 *   B. Every Help link resolves to a real route, a query the page reads, and
 *      an existing guide/anchor
 *   C. Wording: no Parent invitations, roster vs. login, Locations & Resources
 *   D. QAB sequence and the Finance "how the pieces fit" block
 *   E. Permission-aware actions (actionState) and owner-only routing
 *   F. Return navigation (helpReturn / helpHref)
 *   G. Rendered pages: coach vs. owner, past season, checklist when hidden
 *   H. Wiring: popover entry, More sheet link, Settings owner gate, read-only
 *      Help pages, existing QAB guidance untouched
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
function ok(label, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) passed++; else failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${pass ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
const section = (t) => console.log(t);
const R = (rel) => path.join(ROOT, rel);
const read = (rel) => fs.readFileSync(R(rel), "utf8");

/* ---- compile ESM/JSX on require, with next/link stubbed ---- */
const mocks = new Map();
const React = require("react");
mocks.set("next/navigation", { useRouter: () => ({ push() {}, replace() {}, refresh() {} }), usePathname: () => "/help", useSearchParams: () => new URLSearchParams() });
mocks.set("next/link", { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) });
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (mocks.has(request)) return mocks.get(request);
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const { renderToStaticMarkup } = require("react-dom/server");

const help = require(R("lib/help.js"));
const { HELP_GUIDES, findGuide } = require(R("lib/help-guides.js"));
const center = require(R("components/HelpCenter.js"));
const tools = require(R("components/HelpTools.js"));
const { findAnswer: findAnswerById, HELP_ANSWERS } = require(R("lib/help-answers.js"));
const { HELP_GROUPS, actionState, helpReturn, helpHref, guideForPath, isHelpLink, tasksForPath, searchHelp, ACCESS_REASON } = help;

const allActions = HELP_GUIDES.flatMap((g) => g.steps.map((s) => ({ guide: g.slug, step: s.id, ...(s.action ?? {}) })).filter((a) => a.href));
const allTasks = HELP_GROUPS.flatMap((g) => g.tasks);
const allText = (g) => [g.title, g.summary, g.who, ...(g.goodToKnow ?? []), ...(g.pieces?.items ?? []).flatMap((p) => [p.term, p.text]),
  ...g.steps.flatMap((s) => [s.title, s.text, s.action?.label ?? ""])].join(" \n ");

/* ------------------------------------------------------------------------ */
section("A. Content shape");
ok("exactly nine guides", HELP_GUIDES.length, 9);
ok("the approved nine, in order", HELP_GUIDES.map((g) => g.slug), ["setup", "roster", "tournaments", "qab", "money", "files", "locations", "access", "reports"]);
ok("slugs are unique", new Set(HELP_GUIDES.map((g) => g.slug)).size, 9);
for (const g of HELP_GUIDES) {
  ok(`${g.slug}: 3 to 7 steps`, g.steps.length >= 3 && g.steps.length <= 7);
  ok(`${g.slug}: step anchors unique`, new Set(g.steps.map((s) => s.id)).size, g.steps.length);
  ok(`${g.slug}: every step text is short (≤ 170 chars)`, g.steps.filter((s) => s.text.length > 170).map((s) => s.id), []);
  ok(`${g.slug}: has a who line and summary`, Boolean(g.who && g.summary));
  ok(`${g.slug}: at most four Good to know lines`, (g.goodToKnow ?? []).length <= 4);
}

/* ------------------------------------------------------------------------ */
section("B. Every Help link resolves");
// Routes that exist, from the file system.
function pageRoutes(dir, base = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) { if (e.name === "page.js") out.push(base || "/"); continue; }
    const seg = /^\(.*\)$/.test(e.name) ? "" : `/${e.name}`;
    out.push(...pageRoutes(path.join(dir, e.name), base + seg));
  }
  return out;
}
const routes = pageRoutes(R("app"));
const routeFile = (p) => {
  const segs = p.split("/").filter(Boolean);
  const candidates = [path.join("app", "(app)", ...segs, "page.js"), path.join("app", ...segs, "page.js")];
  return candidates.find((c) => fs.existsSync(R(c))) ?? null;
};
// The query keys a page (or its client) is known to read.
const CLIENT_READS = { "/finance": "components/FinanceClient.js", "/facilities": "components/FacilitiesClient.js" };
function readsParam(route, key) {
  const src = read(routeFile(route)) + (CLIENT_READS[route] ? read(CLIENT_READS[route]) : "");
  return new RegExp(`(\\?\\.|\\.|\\[")${key.replace("-", "\\-")}(\\b|"\\])`).test(src);
}
function checkHref(label, href) {
  const [pathPart, hash] = href.split("#");
  const [pathname, query] = pathPart.split("?");
  if (pathname.startsWith("/help")) {
    const slug = pathname.split("/")[2];
    if (!slug) return ok(`${label} → /help`, hash ? false : true);
    const g = findGuide(slug);
    ok(`${label} → guide "${slug}" exists`, Boolean(g));
    if (hash) ok(`${label} → anchor #${hash} exists`, Boolean(g?.steps.some((s) => s.id === hash)));
    return;
  }
  ok(`${label} → route ${pathname} exists`, routes.includes(pathname));
  for (const [k, v] of new URLSearchParams(query ?? "")) {
    ok(`${label} → ${pathname} reads ?${k}`, readsParam(pathname, k));
    if (pathname === "/finance" && k === "tab") {
      const aliases = read("app/(app)/finance/page.js");
      ok(`${label} → finance tab "${v}" is a known tab`, new RegExp(`["\\s]${v}"?:`).test(aliases));
    }
  }
}
for (const a of allActions) checkHref(`${a.guide}#${a.step}`, a.href);
for (const t of allTasks.filter((t) => t.href)) checkHref(`task ${t.id}`, t.href);
for (const g of HELP_GUIDES) for (const r of g.related ?? []) checkHref(`${g.slug} related`, r.href);

/* ------------------------------------------------------------------------ */
section("C. Wording");
const accessText = allText(findGuide("access")).toLowerCase();
const inviteTasks = allTasks.filter((t) => /invite|login|access/i.test(`${t.id} ${t.title}`));
ok("Invitations guide never mentions parents", /parent/.test(accessText), false);
ok("invitation tasks never mention parents", inviteTasks.filter((t) => /parent/i.test(`${t.title} ${t.text}`)).map((t) => t.id), []);
ok("no Help text offers to invite a parent", /invite[^.]*parent|parent[^.]*invit/i.test(JSON.stringify(HELP_GROUPS) + HELP_GUIDES.map(allText).join(" ")), false);
ok("Invitations guide says 'role and team', naming no role list", /Choose their role and team\./.test(allText(findGuide("access"))) && !/Coach or Manager|\bAdmin\b/.test(allText(findGuide("access"))));
for (const slug of ["roster", "access"]) {
  ok(`${slug}: explains roster vs. login`, findGuide(slug).pieces?.title, "On the roster vs. Season Tempo access");
}
ok("staff task says it isn't a login", /doesn't give them a login/.test(allTasks.find((t) => t.id === "add-coach").text));
ok("no retired 'Facilities' page wording", /Go to Facilities|Browse all facilities|Facilities & Files/.test(JSON.stringify(HELP_GROUPS) + HELP_GUIDES.map(allText).join(" ")), false);
ok("Locations guide uses Locations & Resources", /Locations & Resources/.test(allText(findGuide("locations"))));
ok("popover group is named Locations & Resources", HELP_GROUPS.some((g) => g.label === "Locations & Resources"));

/* ------------------------------------------------------------------------ */
section("D. QAB sequence and Finance pieces");
ok("QAB guide runs roster → order → track → record → finish → correct → reports",
  findGuide("qab").steps.map((s) => s.id), ["tournament-roster", "batting-order", "track", "record", "finish", "correct", "reports"]);
ok("QAB guide: enter QABs after a game if not tracked live", /You can enter QABs after a game if you didn't track them live\./.test(findGuide("qab").steps[2].text));
ok("QAB guide says finishing doesn't lock a game", findGuide("qab").goodToKnow.some((t) => /doesn't lock/.test(t)));
ok("QAB guide is feature-marked", findGuide("qab").feature, "qab");
ok("QAB uses the one-reason rule", /one reason/.test(findGuide("qab").steps[3].text));
ok("Finance pieces are the five approved terms", findGuide("money").pieces.items.map((p) => p.term), ["Budget", "Transactions", "Money In", "Player Dues", "Payments"]);
ok("Finance transaction statuses match the product", /To Pay or Paid/.test(findGuide("money").steps.find((s) => s.id === "expense").text)
  && /\["To Pay", "Paid"\]/.test(read("lib/finance-rules.js")));

/* ------------------------------------------------------------------------ */
section("E. Permission-aware actions");
const OWNER = { isAdmin: true, canWrite: true, qab: true, phase: "current" };
const COACH = { isAdmin: false, canWrite: true, qab: true, phase: "current" };
ok("owner may invite", actionState({ href: "/settings?invite=1", requires: "admin" }, OWNER).ok, true);
ok("coach may not invite, and is told why", actionState({ href: "/settings?invite=1", requires: "admin" }, COACH),
  { ok: false, reason: ACCESS_REASON.admin });
ok("coach may add a tournament", actionState({ href: "/tournaments?add=1", requires: "write", creates: true }, COACH).ok, true);
ok("past season holds back creating", actionState({ requires: "write", creates: true, href: "/x" }, { ...OWNER, phase: "past" }).ok, false);
ok("no QAB feature holds back QAB actions", actionState({ requires: "qab", href: "/performance" }, { ...OWNER, qab: false }).ok, false);
ok("unknown access fails closed for owner actions", actionState({ requires: "admin", href: "/settings" }, {}).ok, false);
const ownerForms = allActions.filter((a) => /invite=1|new-season=1/.test(a.href)).concat(allActions.filter((a) => a.href === "/settings"));
ok("every guide action opening an owner form is owner-gated", ownerForms.filter((a) => a.requires !== "admin").map((a) => `${a.guide}#${a.step}`), []);
ok("popover never opens an owner-only form", allTasks.filter((t) => /invite=1|new-season=1/.test(t.href ?? "")).map((t) => t.id), []);
ok("every creating action declares write access", allActions.filter((a) => a.creates && a.requires !== "write").map((a) => `${a.guide}#${a.step}`), []);

/* ------------------------------------------------------------------------ */
section("F. Return navigation");
ok("keeps the exact screen, tab and drawer", helpReturn("/tournaments?open=t1&section=costs"), { href: "/tournaments?open=t1&section=costs", label: "Tournaments" });
ok("names game screens", helpReturn("/tournaments/a/games/b/track")?.label, "QAB tracking");
ok("refuses another site", helpReturn("//evil.example/x"), null);
ok("refuses a full URL", helpReturn("https://evil.example/"), null);
ok("refuses javascript:", helpReturn("javascript:alert(1)"), null);
ok("ignores a path back into Help", helpReturn("/help/qab"), null);
ok("helpHref carries from and keeps the anchor", helpHref("/help/qab#correct", "/finance?tab=payments"), "/help/qab?from=%2Ffinance%3Ftab%3Dpayments#correct");
ok("helpHref with no origin is a plain link", helpHref("/help", null), "/help");
ok("guide for lineup/track is QAB", [guideForPath("/tournaments/x/games/y/lineup")?.slug, guideForPath("/tournaments/x/games/y/track")?.slug], ["qab", "qab"]);
ok("guide for Tournaments, Finance, Settings, Locations", ["/tournaments", "/finance", "/settings", "/facilities"].map((p) => guideForPath(p)?.slug), ["tournaments", "money", "access", "locations"]);
ok("on-this-page tasks still resolve", tasksForPath("/settings").map((t) => t.id), ["invite", "new-season", "rename"]);
ok("isHelpLink", [isHelpLink("/help"), isHelpLink("/help/qab#x"), isHelpLink("/helpdesk"), isHelpLink("/team")], [true, true, false, false]);

/* ------------------------------------------------------------------------ */
section("G. Rendered pages");
const progressOf = (doneIds, qab = true) => {
  const ids = ["name-team", "roster", "tournament", "dues", "game", ...(qab ? ["lineup"] : [])];
  const hrefs = { "name-team": null, roster: "/team", tournament: "/tournaments", dues: "/finance?tab=player-payments", game: "/tournaments", lineup: "/performance" };
  const steps = ids.map((id) => ({ id, done: doneIds.includes(id), href: hrefs[id], creates: !["dues", "game", "lineup"].includes(id), label: id }));
  return { steps, done: steps.filter((x) => x.done).length, total: steps.length };
};
const html = (el) => renderToStaticMarkup(el);
const progress = progressOf(["name-team", "roster", "tournament"]);
const home = html(React.createElement(center.HelpHome, { progress, access: COACH, from: "/tournaments?open=t1" }));
ok("home asks 'How can we help?' with one Search Help box", /<h1>How can we help\?<\/h1>/.test(home) && (home.match(/id="ha-input"/g) ?? []).length === 1);
ok("home shows Popular, not a directory of guides", /Popular/.test(home) && (home.match(/class="hc-guide-card"/g) ?? []).length === 0);
ok("Popular is four questions", (home.match(/class="ha-popular-item"/g) ?? []).length, 4);
ok("home shows setup progress with Continue setup", /Get your team ready/.test(home) && /3 of 6 complete/.test(home) && />Continue setup →</.test(home));
ok("3+ done: compact — next step and View all steps, checklist folded away", /class="hc-progress compact"/.test(home) && /Next:<\/span> <!-- -->?set dues|Next:<\/span> ?dues/.test(home) && /<details class="hc-progress-all"><summary>View all steps<\/summary>/.test(home));
const early = html(React.createElement(center.HelpHome, { progress: progressOf(["name-team", "roster"]), access: COACH, from: null }));
ok("fewer than 3 done: the full checklist, not compact", !/hc-progress compact/.test(early) && !/View all steps/.test(early) && (early.match(/class="hc-progress-mark"/g) ?? []).length === 6);
ok("home offers Browse all guides and Contact support", /Browse all guides/.test(home) && /Contact support/.test(home));
ok("Browse all guides keeps the return path", /href="\/help\?view=guides&amp;from=%2Ftournaments%3Fopen%3Dt1#all-guides"/.test(home));
ok("home Back returns to the drawer", /<a href="\/tournaments\?open=t1" class="hc-back">.*Back to (<!-- -->)?Tournaments<\/a>/.test(home));
const browse = html(React.createElement(center.HelpHome, { progress, access: COACH, from: "/tournaments?open=t1", showGuides: true }));
ok("Browse all guides lists all nine", (browse.match(/class="hc-guide-card"/g) ?? []).length, 9);
ok("guide cards carry the return path", /href="\/help\/qab\?from=%2Ftournaments%3Fopen%3Dt1"/.test(browse));
const past = html(React.createElement(center.HelpHome, { progress, access: { ...COACH, phase: "past" }, from: null }));
ok("past season: progress explains instead of offering Continue setup", /viewing a past season/.test(past) && !/Continue setup/.test(past));
const doneAll = html(React.createElement(center.HelpHome, { progress: progressOf(["name-team", "roster", "tournament", "dues", "game", "lineup"]), access: COACH, from: null }));
ok("finished setup: the progress card steps aside", /Get your team ready/.test(doneAll), false);
const noQab = progressOf(["name-team"], false);
ok("no QAB: no batting-order step", noQab.steps.some((x) => x.id === "lineup"), false);
const noQabHome = html(React.createElement(center.HelpHome, { progress: noQab, access: { ...COACH, qab: false }, from: null }));
ok("no QAB: Popular has no QAB question", /Track QABs/.test(noQabHome), false);
const answered = html(React.createElement(center.HelpHome, { progress, access: COACH, from: "/finance", answer: "dues-exempt" }));
ok("?a= opens a direct answer with its action and full guide", /A player doesn(&#x27;|’)t owe dues/.test(answered) && />Open Player Dues →</.test(answered) && /Full guide: Manage team money/.test(answered));
ok("answer links keep from", /href="\/help\/money\?from=%2Ffinance#dues"/.test(answered));
const coachLogin = html(React.createElement(center.HelpHome, { progress, access: COACH, from: null, answer: "coach-login" }));
ok("coach asking about sign-in: told why, no owner-only Invite button", !/settings\?invite=1/.test(coachLogin) && coachLogin.includes(ACCESS_REASON.admin.replace(/'/g, "&#x27;")));
const ownerLogin = html(React.createElement(center.HelpHome, { progress, access: OWNER, from: null, answer: "coach-login" }));
ok("owner asking about sign-in: Invite someone offered", /href="\/settings\?invite=1"/.test(ownerLogin));
const searched = html(React.createElement(center.HelpHome, { progress, access: COACH, from: null, query: "wrong batter" }));
ok("?q= answers first: wrong batter -> Fix a completed plate appearance", /<h2 class="ha-answer-title">Fix a completed plate appearance<\/h2>/.test(searched) && /Open Performance →/.test(searched));
ok("while answering, Popular and setup step aside", !/Popular/.test(searched) && !/Get your team ready/.test(searched));
const coachAccess = html(React.createElement(center.HelpGuide, { guide: findGuide("access"), access: COACH, from: "/settings" }));
ok("coach: no Invite someone button", /href="\/settings\?invite=1"/.test(coachAccess), false);
ok("coach: told why, in access terms", coachAccess.includes(ACCESS_REASON.admin.replace(/'/g, "&#x27;")));
const ownerAccess = html(React.createElement(center.HelpGuide, { guide: findGuide("access"), access: OWNER, from: "/settings" }));
ok("owner: Invite someone button present", /href="\/settings\?invite=1"/.test(ownerAccess));
ok("guide steps carry anchors", /id="invite"/.test(ownerAccess));
const lockedQab = html(React.createElement(center.HelpGuide, { guide: findGuide("qab"), access: { ...OWNER, qab: false }, from: null }));
ok("no-QAB org: guide explains Premium, no Performance buttons", /isn(&#x27;|’|&rsquo;)t turned on/.test(lockedQab) && !/href="\/performance"/.test(lockedQab));
const setupOwner = html(React.createElement(center.HelpGuide, { guide: findGuide("setup"), access: OWNER, from: "/dashboard" }));
ok("guide-to-guide links keep the return path", /href="\/help\/access\?from=%2Fdashboard"/.test(setupOwner));
const roster = html(React.createElement(center.HelpGuide, { guide: findGuide("roster"), access: COACH, from: null }));
ok("roster guide renders roster vs. access", /On the roster vs\. Season Tempo access/.test(roster));

/* ------------------------------------------------------------------------ */
section("H. Wiring");
const menu = read("components/HelpMenu.js");
ok("popover links to Help & Getting Started with the current screen", /helpHref\("\/help", here\)/.test(menu) && /Help &amp; Getting Started/.test(menu));
ok("popover asks this page's questions first, then Search Help", /questionsForPath\(pathname/.test(menu) && menu.indexOf("On this page") < menu.indexOf('placeholder="Search Help"'));
ok("popover no longer lists the common-task directory", /HELP_GROUPS|Common tasks/.test(menu), false);
ok("popover answers and Enter both keep this screen as from", /helpHref\(`\/help\?a=\$\{a\.id\}`, here\)/.test(menu) && /helpHref\(`\/help\?q=\$\{encodeURIComponent\(query\.trim\(\)\)\}`, here\)/.test(menu));
const nav = read("components/NavSidebar.js");
ok("More sheet Help row is a link, not a nested popover", !/HelpMenu/.test(nav) && /helpHref\("\/help"/.test(nav));
const settings = read("components/SettingsClient.js");
ok("Settings: owner-only forms don't auto-open for others", /OWNER_ONLY_PANELS\.includes\(autoOpen\) && !isAdmin \? null : autoOpen/.test(settings));
ok("Settings: invite form renders only for owners", /editing === "invite" && isAdmin &&/.test(settings));
ok("Settings: new season form renders only for owners", /editing === "season-new" && isAdmin &&/.test(settings));
const pages = ["app/(app)/help/page.js", "app/(app)/help/[guide]/page.js", "components/HelpCenter.js", "app/(app)/help/access.js"].map(read).join("\n");
ok("Help pages import no server actions", /lib\/actions/.test(pages), false);
ok("Help pages write nothing", /\.(insert|update|upsert|delete)\(/.test(pages), false);
ok("Help pages live inside the signed-in app shell", fs.existsSync(R("app/(app)/help/page.js")));
ok("/help is not a public route", /["']\/help["']/.test(read("lib/supabase/middleware.js")), false);
ok("checklist ignores the Home dismissal", /onboarding_hidden|setup\.hidden/.test(read("app/(app)/help/page.js")), false);
const perf = read("app/(app)/performance/page.js");
ok("existing Performance QAB guidance unchanged", /<details className="perf-guide" open=\{firstTime\}>\s*<summary>How QAB tracking works<\/summary>/.test(perf));
ok("Home Getting started card unchanged", /onboarding_hidden && <GettingStarted/.test(read("app/(app)/dashboard/page.js")));

/* ------------------------------------------------------------------------ */
section("I. Guide selector, search and refinements (2026-11 revision)");
const qabPage = html(React.createElement(center.HelpGuide, { guide: findGuide("qab"), access: OWNER, from: "/finance?tab=payments" }));
ok("guide page has no permanent list of guides", /hc-nav/.test(qabPage) || /class="hc-picker-item/.test(qabPage), false);
ok("guide page shows a compact selector with the current guide", /class="hc-picker-current">Track Quality At-Bats</.test(qabPage));
ok("guide page has Help search", /aria-label="Search help"/.test(qabPage));
const pickerOpen = html(React.createElement(tools.HelpGuidePicker, { current: "qab", from: "/finance?tab=payments", initialOpen: true }));
ok("selector lists all nine guides when opened", (pickerOpen.match(/class="hc-picker-item/g) ?? []).length, 9);
ok("selector marks the current guide", /aria-current="page"[^>]*>Track Quality At-Bats|class="hc-picker-item active"[^>]*>Track Quality At-Bats/.test(pickerOpen));
ok("selector links keep from", (pickerOpen.match(/href="\/help\/[a-z]+\?from=%2Ffinance%3Ftab%3Dpayments"/g) ?? []).length, 9);
ok("selector offers the way back to all guides", /href="\/help\?view=guides&amp;from=%2Ffinance%3Ftab%3Dpayments#all-guides"[^>]*>All guides/.test(pickerOpen));
const top = (q) => searchHelp(q)?.[0]?.href;
ok("search: 'lineup' answers batting order", top("lineup"), "/help?a=qab-lineup");
ok("search: 'add parent' answers it directly", top("add parent"), "/help?a=parent-add");
ok("search: 'invite' answers sign-in/access first", top("invite"), "/help?a=coach-login");
ok("search: 'venmo' answers recording a payment", top("venmo"), "/help?a=dues-payment");
ok("search: 'wrong batter' answers fixing a plate appearance", top("wrong batter"), "/help?a=qab-fix");
ok("search: 'hotel' finds the hotel answer", top("hotel"), "/help?a=tournament-places");
ok("search: no duplicate titles in results", (() => { const t = searchHelp("dues").map((r) => r.title.toLowerCase()); return t.length === new Set(t).size; })());
ok("search: nonsense finds nothing", searchHelp("zzzqqq"), []);
ok("search: empty or stop-words-only query is not a search", [searchHelp("   "), searchHelp("how do i")], [null, null]);
ok("search: at most six results", searchHelp("add").length <= 6);
ok("search results resolve to real answers, guides and anchors", ["dues", "game", "invite", "hotel", "fix"].every((q) => searchHelp(q).every((r) => {
  if (r.kind === "answer") return Boolean(findAnswerById(r.id));
  const [p2, h] = r.href.split("#"); const g = findGuide(p2.split("/")[2]); return g && (!h || g.steps.some((x) => x.id === h)); })));
const searchOpen = html(React.createElement(tools.HelpSearch, { from: "/finance?tab=payments", initialQuery: "dues" }));
ok("search result links keep from", /href="\/help(\/[a-z]+)?\?(a=[a-z-]+&amp;)?from=%2Ffinance%3Ftab%3Dpayments(#[a-z-]+)?"/.test(searchOpen));
ok("one search engine: every Help surface calls searchHelp/askHelp", [read("components/HelpMenu.js"), read("components/HelpAsk.js"), read("components/HelpTools.js")].every((src) => /searchHelp\(/.test(src)));
ok("landing page has Search Help", /id="ha-input"/.test(home) && /placeholder="Search Help"/.test(home));
const everything = JSON.stringify(HELP_GROUPS) + HELP_GUIDES.map(allText).join(" ") + JSON.stringify(ACCESS_REASON);
ok("no unverified phone-print claim", /On a phone/i.test(everything), false);
ok("reasons don't hard-code a role list", /coaches, managers and owners|Only an organization owner can do this/i.test(everything), false);
ok("who lines describe access, not roles", HELP_GUIDES.filter((g) => /Coaches, managers|Anyone on the team/.test(g.who)).map((g) => g.slug), []);

/* ------------------------------------------------------------------------ */
section("J. Copy refinement pass (verified against code, 2026-11)");
const all = HELP_GUIDES.map(allText).join(" \n ");
ok("Setup is marked as the place to start", /^New to Season Tempo\? Start here\./.test(findGuide("setup").summary));
ok("Setup: considering tournaments can be added before committing", /still considering, before you commit/.test(all));
ok("Setup: new season copy matches start_next_season (chosen people, optional budget, not made current)",
  /Choose who carries over/.test(all) && /p_player_ids/.test(read("lib/actions/seasons.js")) && /copy_budget/.test(read("lib/actions/seasons.js")));
ok("Roster: primary contact wording", /Choose a primary contact for the player\./.test(all));
ok("Roster: inactive keeps dues and payment history", /Making a player inactive doesn't remove their dues or payment history\./.test(all)
  && /\.update\(\{ is_active:/.test(read("lib/actions/roster.js")));
ok("Roster: old dues-totals line removed", /Season dues totals still count/.test(all), false);
ok("Tournaments: no blanket 'Only Committed tournaments count'", /Only Committed tournaments count/.test(all), false);
ok("Tournaments: unassigned committed cost wording matches Finance",
  /not assigned to a budget category/.test(all) && /decision === "Committed" &&\s*!t\.budget_item_id/.test(read("lib/queries/finance.js")));
ok("QAB: no 'Past games can be tracked any time'", /Past games can be tracked any time/.test(all), false);
ok("QAB: no offline/lost-signal promise until verified in production", /signal|offline|back online/i.test(all), false);
ok("Finance: Money In wording matches the server (income stored as Paid, counted once it has an amount)",
  /once you enter the amount/.test(all) && /income.*isActual|is_income && isActual/.test(read("lib/queries/finance.js")));
ok("Finance: exempt note present and tied to Set player dues", /recorded as exempt/.test(all) && /owing no dues/.test(read("components/FinanceClient.js")));
ok("Files: no link-expiry implementation detail", /60 seconds|expires/.test(all), false);
ok("Locations: Saved matches the isOurs rule (added/notes, links, non-declined tournaments)",
  /added, wrote notes on, or linked to a tournament, and fields where one of your tournaments is held \(unless you declined it\)/.test(all)
  && /isOurs: committedHistory\.length > 0 \|\| orgNotes !== null \|\| links\.length > 0/.test(read("lib/queries/facilities.js")));
ok("who lines are permission-neutral", HELP_GUIDES.filter((g) => !/team members with access|organization owner tasks/.test(g.who)).map((g) => g.slug), []);
ok("no 'Anyone on the team'", /Anyone on the team/.test(all), false);
ok("owner-only actions still say owner explicitly", /organization owner tasks/.test(findGuide("access").who) && /owner tasks/.test(findGuide("setup").who));
ok("Reports: no phone-browser printing statement", /phone|browser/i.test(allText(findGuide("reports"))), false);

/* ------------------------------------------------------------------------ */
section("K. Everyday language, synonyms and typos (deterministic)");
const NATURAL = [
  ["wrong batter", "qab-fix"],
  ["battr wrong", "qab-fix"],
  ["fix a mistake in the game", "qab-fix"],
  ["enter QAB after game", "qab-after-game"],
  ["qabs after the game", "qab-after-game"],
  ["enter qabs from scorebook", "qab-after-game"],
  ["player doesn't owe dues", "dues-exempt"],
  ["my daughter doesnt pay", "dues-exempt"],
  ["exmpt", "dues-exempt"],
  ["who hasnt paid", "dues-owed"],
  ["who still owes", "dues-owed"],
  ["coach can't login", "coach-login"],
  ["assistant cant sign in", "coach-login"],
  ["invite asistant coach", "coach-login"],
  ["how do i add a tournment", "tournament-add"],
  ["where do i put the hotel", "tournament-places"],
  ["add a field for the tournment", "tournament-places"],
  ["mom phone number", "parent-add"],
  ["add kid", "player-add"],
  ["girl quit the team", "player-left"],
  ["venmo", "dues-payment"],
  ["how do player dues work", "dues-how"],
  ["difference between budget and transactions", "budget-vs-transactions"],
  ["delete budget line", "budget-line-delete"],
  ["copy lineup", "qab-lineup"],
  ["qab percentage report", "qab-report"],
  ["print schedule for parents", "report-parents"],
  ["upload waiver", "file-upload"],
  ["parking notes", "place-notes"],
  ["start new season", "season-next"],
];
for (const [q, id] of NATURAL) ok(`"${q}" -> ${id}`, searchHelp(q)?.[0]?.id, id);
ok("negation matters: 'doesn't owe' and 'hasn't paid' reach different answers", [top("player doesn't owe"), top("who hasn't paid")], ["/help?a=dues-exempt", "/help?a=dues-owed"]);
ok("every answer's guide and anchor exist", HELP_ANSWERS.filter((a) => { const [g, h] = a.guide.split("#"); const gd = findGuide(g); return !gd || (h && !gd.steps.some((x) => x.id === h)); }).map((a) => a.id), []);
ok("every answer's action is permission-tagged like the guides (owner forms are admin, creating needs write)",
  HELP_ANSWERS.filter((a) => a.action && ((/invite=1|new-season=1/.test(a.action.href) && a.action.requires !== "admin") || (a.action.creates && a.action.requires !== "write"))).map((a) => a.id), []);
ok("answers keep approved wording: no parent invitations, no 'Facilities' page name, no phone-print or offline promises",
  /invite[^.]*parent|Go to Facilities|On a phone|back online|offline|60 seconds/i.test(JSON.stringify(HELP_ANSWERS)), false);
ok("answers are short (≤ 260 characters)", HELP_ANSWERS.filter((a) => a.answer.length > 260).map((a) => a.id), []);
const { questionsForPath: qfp, popularAnswers: pop } = require(R("lib/help-answers.js"));
ok("Performance popover asks: track, after the game, fix", qfp("/performance").map((a) => a.id), ["qab-track", "qab-after-game", "qab-fix"]);
ok("Finance popover asks: dues, payment, budget vs. transactions", qfp("/finance").map((a) => a.id), ["dues-how", "dues-payment", "budget-vs-transactions"]);
ok("Tournaments popover asks: games, costs, hotel or field", qfp("/tournaments").map((a) => a.id), ["games-add", "tournament-costs", "tournament-places"]);
ok("tracking screen asks QAB questions, not tournament ones", qfp("/tournaments/x/games/y/track")[0].id, "qab-track");
ok("Popular swaps out QAB when Performance is off", pop({ qab: false }).some((a) => a.action?.requires === "qab"), false);

/* ------------------------------------------------------------------------ */
section("L. QAB awareness, QAB Notes answer (rebased on d809c2b)");
ok("non-QAB Performance popover: no QAB questions, three relevant ones", qfp("/performance", { qab: false }).map((a) => a.id), ["performance-premium", "games-add", "tournament-roster"]);
ok("non-QAB game screens: no QAB questions", qfp("/tournaments/x/games/y/track", { qab: false }).some((a) => a.action?.requires === "qab"), false);
ok("non-QAB Reports popover: QAB report replaced", qfp("/reports", { qab: false }).map((a) => a.id), ["report-parents", "season-previous"]);
ok("no screen ever asks more than three questions", ["/performance", "/finance", "/tournaments", "/team", "/settings", "/facilities", "/files", "/reports", "/dashboard", "/contacts"]
  .every((p2) => qfp(p2).length <= 3 && qfp(p2, { qab: false }).length <= 3));
ok("no non-QAB question list for any screen contains a QAB question",
  ["/performance", "/finance", "/tournaments", "/tournaments/a/games/b/lineup", "/team", "/settings", "/facilities", "/files", "/reports", "/dashboard", "/contacts"]
    .every((p2) => !qfp(p2, { qab: false }).some((a) => a.action?.requires === "qab")));
ok("non-QAB Performance question is 'Learn about…', never implying self-service enabling",
  [findAnswerById("performance-premium").title, /\b(turn on|enable|upgrade)\b/i.test(findAnswerById("performance-premium").title + " " + findAnswerById("performance-premium").answer)],
  ["Learn about Performance and QAB tracking", false]);
ok("searching 'turn on qab' or 'learn about performance' still finds it", [searchHelp("turn on qab")[0].id, searchHelp("learn about performance")[0].id], ["performance-premium", "performance-premium"]);
ok("the Performance explainer answer is only offered without QAB", qfp("/performance").some((a) => a.id === "performance-premium"), false);
ok("popover reads QAB availability from the layout's feature flags, not a new query",
  /useHelpContext\(\)/.test(menu) && /questionsForPath\(pathname \?\? "", \{ qab \}\)/.test(menu)
  && /<HelpContextProvider qab=\{features\?\.qab\}>\{children\}<\/HelpContextProvider>/.test(read("app/(app)/layout.js")));
ok("Help context defaults to QAB off", /createContext\(\{ qab: false \}\)/.test(read("components/HelpContext.js")));
for (const q of ["add note", "note on at bat", "note on QAB", "comment on plate appearance", "add notes to qabs"]) {
  ok(`"${q}" -> qab-note`, searchHelp(q)?.[0]?.id, "qab-note");
}
const note = findAnswerById("qab-note");
ok("note answer: optional, attached to the plate appearance, editable in Review & Edit", /optional/.test(note.answer) && /plate appearance/.test(note.answer) && /Review & Edit/.test(note.answer));
ok("note answer never implies notes change calculations", /don't change QAB counts or percentages/.test(note.answer) && !/affects? (QAB|the QAB|percent)/i.test(note.answer));
ok("QAB guide's record step mentions + Add note", /\+ Add note/.test(findGuide("qab").steps.find((x) => x.id === "record").text));
ok("QAB Notes production code is present and untouched by Help", /function NoteField/.test(read("components/TrackerClient.js")) && fs.existsSync(R("scripts/check-qab-notes.js")));
ok("npm run check runs check-queue-recovery, check-qab-notes and check-help exactly once each",
  ["check-queue-recovery.js", "check-qab-notes.js", "check-help.js"].map((f) => (read("package.json").match(new RegExp(f.replace(".", "\\."), "g")) ?? []).length), [1, 1, 1]);

{ const css = read("app/globals.css"); ok("globals.css braces balance (merge guard)", (css.match(/\{/g) ?? []).length, (css.match(/\}/g) ?? []).length); }
ok("QAB Notes styles still close before the Help block", /overflow-wrap: anywhere;\n\}\n\n\/\* ===== Help & Getting Started/.test(read("app/globals.css")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
