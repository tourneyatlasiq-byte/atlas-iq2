/**
 * Tournament Schedule report — BEHAVIOURAL (2026-11).
 *
 * The parent schedule shows Committed and Considering tournaments, each
 * labelled, with a legend when anything is tentative. These checks run the
 * real query against an in-memory database and render the real document:
 *
 *   A. tournamentScheduleReport: which tournaments are included, the status
 *      vocabulary that can reach the page, chronological order, games
 *   B. TournamentScheduleReport, rendered: a label on every row, the legend,
 *      tentative wording, the empty state
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

/* ---------------- an in-memory database that honours eq / in ---------------- */

function fakeDb(tables) {
  const asked = [];
  return {
    asked,
    from(table) {
      const filters = [];
      let one = false;
      const run = () => {
        const rows = (tables[table] ?? []).filter((r) => filters.every(([k, op, v]) => (op === "eq" ? r[k] === v : v.includes(r[k]))));
        return { data: one ? rows[0] ?? null : rows, error: null };
      };
      const b = {
        select() { return b; },
        eq(k, v) { filters.push([k, "eq", v]); asked.push({ table, eq: [k, v] }); return b; },
        in(k, v) { filters.push([k, "in", v]); asked.push({ table, in: [k, v] }); return b; },
        maybeSingle() { one = true; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
  };
}

const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() + n * 86400000));
const S = "season-1";
const tournaments = [
  { id: "c-past", season_id: S, name: "Dog Days Opener", decision: "Committed", paid_status: "Paid in Full", start_date: day(-90), end_date: day(-89), location: "Cartersville, GA", facility: null },
  { id: "k-past", season_id: S, name: "Old Idea Classic", decision: "Considering", start_date: day(-30), end_date: day(-29), location: null, facility: null },
  { id: "k-next", season_id: S, name: "Magnolia Showcase", decision: "Considering", paid_status: "Waitlisted", start_date: day(20), end_date: day(22), location: null,
    facility: { name: "Magnolia Fields", city: "Huntsville", state: "AL", street_address: "900 Magnolia Trace", zip: "35806" } },
  { id: "d-next", season_id: S, name: "Declined Cup", decision: "Declined", start_date: day(10), end_date: day(11), location: "Nowhere", facility: null },
  { id: "c-next", season_id: S, name: "Red Clay Classic", decision: "Committed", paid_status: "Deposit Paid", start_date: day(10), end_date: day(11), location: "Columbus, GA", facility: null },
  // Start date is required by the form and the server, so every real
  // tournament has one; a single-day event has no end date.
  { id: "k-oneday", season_id: S, name: "One Day Shootout", decision: "Considering", start_date: day(30), end_date: null, location: null, facility: null },
  { id: "c-wait", season_id: S, name: "Winter Warm-Up", decision: "Committed", paid_status: "Waitlisted", start_date: day(40), end_date: day(41), location: "Perry, GA", facility: null },
  { id: "c-reg", season_id: S, name: "Spring Opener Slam", decision: "Committed", paid_status: "Registered", start_date: day(50), end_date: day(51), location: "Chattanooga, TN", facility: null },
  { id: "c-notreg", season_id: S, name: "Gulf Coast Classic", decision: "Committed", paid_status: "Not Registered", start_date: day(60), end_date: day(61), location: "Gulf Shores, AL", facility: null },
  { id: "other", season_id: "season-2", name: "Another Season", decision: "Committed", start_date: day(5), end_date: day(6), location: null, facility: null },
];
const games = [
  { id: "g1", season_id: S, tournament_id: "c-next", game_date: day(10), start_time: "09:00:00", opponent_name: "Bayou Blaze 14U" },
  { id: "g2", season_id: S, tournament_id: "k-next", game_date: day(20), start_time: null, opponent_name: null },
  { id: "g3", season_id: S, tournament_id: "d-next", game_date: day(10), start_time: "08:00:00", opponent_name: "Never Printed" },
];
const season = { id: S, name: "2026-27", team: { id: "team", name: "Bramblewood 14U Gold", organization: { id: "org", name: "Bramblewood Fastpitch", logo_url: null } } };

(async () => {
  const { tournamentScheduleReport } = require(path.join(ROOT, "lib", "queries", "reports", "tournament-schedule.js"));

  console.log("A. tournamentScheduleReport (in-memory database)");
  db = fakeDb({ seasons: [season], tournaments, games });
  const report = await tournamentScheduleReport(S);
  const rows = report.tournaments;

  assertEq("asks the database for Committed and Considering only",
    db.asked.filter((a) => a.table === "tournaments" && a.in).map((a) => a.in), [["decision", ["Committed", "Considering"]]]);
  assertEq("includes Committed (past and future) and upcoming Considering, in date order",
    rows.map((t) => t.id), ["c-past", "c-next", "k-next", "k-oneday", "c-wait", "c-reg", "c-notreg"]);
  assertEq("excludes Declined", rows.some((t) => t.id === "d-next"), false);
  assertEq("excludes a Considering tournament that has already ended", rows.some((t) => t.id === "k-past"), false);
  assertEq("stays inside the season", rows.some((t) => t.id === "other"), false);
  assertEq("every row carries exactly Committed or Considering",
    rows.map((t) => [t.id, t.status]), [["c-past", "Committed"], ["c-next", "Committed"], ["k-next", "Considering"], ["k-oneday", "Considering"],
      ["c-wait", "Committed"], ["c-reg", "Committed"], ["c-notreg", "Committed"]]);
  assertEq("only Committed + Waitlisted is flagged waitlisted (Paid in Full, Deposit Paid, Registered, Not Registered and Considering + Waitlisted are not)",
    rows.filter((t) => t.waitlisted).map((t) => t.id), ["c-wait"]);
  assertEq("no registration wording reaches the payload",
    ["Paid in Full", "Deposit Paid", "Not Registered", "\"Registered\"", "paid_status"].filter((w) => JSON.stringify(report).includes(w)), []);
  assertEq("no raw decision field reaches the document", rows.some((t) => "decision" in t), false);
  assertEq("the word Declined appears nowhere in the payload", JSON.stringify(report).includes("Declined"), false);
  assertEq("games attach to included tournaments only",
    rows.map((t) => [t.id, t.games.map((g) => g.id)]), [["c-past", []], ["c-next", ["g1"]], ["k-next", ["g2"]], ["k-oneday", []], ["c-wait", []], ["c-reg", []], ["c-notreg", []]]);
  assertEq("a Declined tournament's game is never printed", JSON.stringify(report).includes("Never Printed"), false);
  assertEq("existing details are kept (facility and address)", rows.find((t) => t.id === "k-next").place,
    { name: "Magnolia Fields", area: "Huntsville, AL", address: "900 Magnolia Trace, Huntsville, AL, 35806" });
  assertEq("the cost and note fields stay out of the payload",
    rows.every((t) => Object.keys(t).sort().join() === "endDate,games,id,name,place,startDate,status,waitlisted"), true);

  console.log("B. the document, rendered");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { TournamentScheduleReport } = require(path.join(ROOT, "components", "reports", "TournamentScheduleReport.js"));
  const render = (r, detail) => renderToStaticMarkup(React.createElement(TournamentScheduleReport, { report: r, initialDetail: detail }));
  const count = (html, re) => (html.match(re) ?? []).length;

  {
    const html = render(report);
    assertEq("every tournament row has a status label", count(html, /<li class="sch-item[^"]*">/g), count(html, /<p class="sch-status /g));
    assertEq("plain Committed rows are labelled Committed", count(html, /<p class="sch-status sch-status-committed">Committed<\/p>/g), 4);
    assertEq("the Committed + Waitlisted row is labelled Committed • Waitlisted, in its own waitlisted style",
      count(html, /<p class="sch-status sch-status-waitlisted">Committed • Waitlisted<\/p>/g), 1);
    {
      const legendAt = html.indexOf('class="sch-legend"');
      assertEq("legend and footer sit inside the closing block",
        /<div class="sch-end"><section class="sch-legend"[\s\S]*<footer class="rpt-foot">[\s\S]*<\/footer><\/div>/.test(html), true);
      assertEq("the legend sits after the schedule and immediately before the footer, labelled Schedule status",
        [legendAt > html.indexOf("</ol>"), html.indexOf("<footer", legendAt) > legendAt,
          /<section class="sch-legend"[^>]*><p class="sch-legend-label">Schedule status<\/p>/.test(html),
          html.indexOf('class="sch-legend"') > html.lastIndexOf("</li>")], [true, true, true, true]);
      assertEq("the schedule begins directly after the header", /<\/header><ol class="sch-list">/.test(html), true);
      assertEq("legend pills use the same three treatments as the rows",
        ["sch-status-committed\">Committed<", "sch-status-considering\">Considering<", "sch-status-waitlisted\">Committed • Waitlisted<"]
          .map((frag) => html.slice(legendAt).includes(frag.replace(/\\/g, ""))), [true, true, true]);
    }
    assertEq("Considering rows are labelled Considering, styled apart", count(html, /<p class="sch-status sch-status-considering">Considering<\/p>/g), 2);
    assertEq("Considering rows carry the tentative row style", count(html, /<li class="sch-item sch-item-tentative">/g), 2);
    assertEq("the legend appears once, explaining Considering and Waitlisted",
      [count(html, /class="sch-legend"/g), /Tentative and subject to change/.test(html), /The team is committed to attending if a spot becomes available\./.test(html)], [1, true, true]);
    assertEq("no per-tournament game-times line anywhere", /will be added when available/.test(html), false);
    const htmlGames = render(report, "games");
    assertEq("one general note in the footer while an attending tournament has no games",
      [count(htmlGames, /Game times and opponents will be added as schedules become available\./g),
        /<footer class="rpt-foot">[\s\S]*Game times and opponents will be added as schedules become available\.[\s\S]*<\/footer>/.test(htmlGames)], [1, true]);
    assertEq("header reads Updated <date>", [/Updated [A-Z][a-z]+ \d{1,2}, \d{4}/.test(html), /Prepared/.test(html)], [true, false]);
    assertEq("title and footer are unchanged", [/2026-27 Tournament Schedule<\/h1>/.test(html), /Tournament dates and game times can change\./.test(html)], [true, true]);
  }
  {
    const legend = (ts) => {
      const html = render({ ...report, tournaments: ts });
      return {
        legend: count(html, /class="sch-legend"/g),
        considering: /Tentative and subject to change/.test(html),
        waitlisted: /if a spot becomes available/.test(html),
      };
    };
    const committedPlain = report.tournaments.filter((t) => t.status === "Committed" && !t.waitlisted);
    const considering = report.tournaments.filter((t) => t.status === "Considering");
    const waitRow = report.tournaments.filter((t) => t.waitlisted);
    assertEq("only plain Committed: no legend", legend(committedPlain), { legend: 0, considering: false, waitlisted: false });
    assertEq("Committed + Considering: Considering explained, no Waitlisted line",
      legend([...committedPlain, ...considering]), { legend: 1, considering: true, waitlisted: false });
    assertEq("Committed + Waitlisted, nothing Considering: Waitlisted explained, no Considering line",
      legend([...committedPlain, ...waitRow]), { legend: 1, considering: false, waitlisted: true });
    {
      const html = render({ ...report, tournaments: committedPlain });
      assertEq("all plain Committed: every row still labelled", count(html, /sch-status-committed/g), committedPlain.length);
    }
  }
  {
    const html = render({ ...report, tournaments: [] });
    assertEq("empty season: neutral wording that doesn't mention committing",
      /No tournaments are on the schedule for this season yet\./.test(html), true);
  }

  {
    const css = fs.readFileSync(path.join(ROOT, "app", "reports", "tournament-schedule", "schedule.css"), "utf8");
    const rule = (sel) => (css.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`)) ?? [])[1] ?? "";
    assertEq("black-and-white distinction kept: Considering dashed, Committed and Waitlisted solid",
      [/border-style:\s*dashed/.test(rule(".sch-status-considering")), /dashed/.test(rule(".sch-status")), /dashed/.test(rule(".sch-status-waitlisted"))],
      [true, false, false]);
    assertEq("each status has a tint, and print keeps it", [/background:/.test(rule(".sch-status")), /background:/.test(rule(".sch-status-considering")),
      /background:/.test(rule(".sch-status-waitlisted")), /print-color-adjust:\s*exact/.test(rule(".sch-status"))], [true, true, true, true]);
    assertEq("no red in the status treatments", /#(c0392b|d32f2f|e53935|b91c1c|dc2626|ef4444)|\bred\b/i.test(
      rule(".sch-status") + rule(".sch-status-considering") + rule(".sch-status-waitlisted")), false);
    assertEq("legend and footer form one unbreakable closing block", /\.sch-end\s*\{\s*break-inside:\s*avoid;\s*\}/.test(css), true);
    assertEq("the legend is kept in one piece and with the footer", [/break-inside:\s*avoid/.test(rule(".sch-legend")), /break-after:\s*avoid/.test(rule(".sch-legend"))], [true, true]);
    assertEq("rows and names are not tinted", [/background/.test(rule(".sch-item")), /background/.test(rule(".sch-name"))], [false, false]);
  }

  {
    const withGames = (t) => ({ ...t, games: [{ id: `g-${t.id}`, date: t.startDate, startTime: "09:00:00", opponent: "Bayou Blaze 14U" }] });
    const note = (ts, detail = "games") => /will be added as schedules become available/.test(render({ ...report, tournaments: ts }, detail));
    const attending = report.tournaments.filter((t) => t.status === "Committed" && !t.waitlisted);
    const others = report.tournaments.filter((t) => !(t.status === "Committed" && !t.waitlisted));
    assertEq("note hidden when every attending tournament has games, even if Considering/waitlisted ones have none",
      note([...attending.map(withGames), ...others.map((t) => ({ ...t, games: [] }))]), false);
    assertEq("note hidden when every tournament has games", note(report.tournaments.map(withGames)), false);
    assertEq("note shown when one attending tournament has no games",
      note([...attending.slice(1).map(withGames), { ...attending[0], games: [] }]), true);
    assertEq("note hidden on an empty schedule", note([]), false);
    assertEq("Tournaments only: the game-availability note never appears, even with no games entered",
      note([...attending.map((t) => ({ ...t, games: [] }))], "tournaments"), false);
  }

  /* ---------------- E. report detail: Tournaments only | Include game schedule ---------------- */

  console.log("E. report detail choice");
  {
    const g = (id, date, time, opp, type) => ({ id, date, startTime: time, opponent: opp, gameType: type });
    const withGames = report.tournaments.map((t) =>
      t.id === "c-next" ? { ...t, games: [g("g1", t.startDate, "09:00:00", "Bayou Blaze 14U", "Pool"), g("g2", t.startDate, "11:30:00", "Ridge Runners 14U", "Pool"), g("g3", t.endDate, "10:00:00", null, "Bracket")] }
      : t.id === "c-reg" ? { ...t, games: [g("g4", t.startDate, "08:00:00", "Coastal Cyclones 14U", "Championship")] }
      : { ...t, games: [] });
    const r = { ...report, tournaments: withGames };
    const only = render(r), def = render(r, undefined), games = render(r, "games");
    const rows = (html) => (html.match(/class="sch-item[^"]*"/g) ?? []).length;
    const gameRows = (html) => (html.match(/<li><span class="sch-time">/g) ?? []).length + (html.match(/<li><span class="sch-opp">/g) ?? []).length;
    assertEq("default is Tournaments only", def, only);
    assertEq("Tournaments only: no game is printed at all", [gameRows(only), /vs Bayou Blaze|sch-games|sch-day/.test(only)], [0, false]);
    assertEq("Include game schedule: every entered game is printed (4)", gameRows(games), 4);
    assertEq("...with date, time, opponent and game type", [/<p class="sch-day-label">(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]* [A-Z][a-z]+ \d+</i.test(games), /9:00 AM/.test(games), /vs Bayou Blaze 14U/.test(games), /· Pool/.test(games), /· Championship/.test(games)], [true, true, true, true, true]);
    assertEq("...an unknown opponent reads 'Opponent to be announced'", /Opponent to be announced<span class="sch-gtype"> · Bracket/.test(games), true);
    assertEq("...results, scores and notes are never printed", /runs|score|result|notes/i.test(games.slice(games.indexOf("<article"))), false);
    assertEq("several games under one tournament, grouped by day under it", (games.match(/class="sch-day"/g) ?? []).length, 3);
    assertEq("several tournaments with games", (games.match(/sch-games-first/g) ?? []).length, 2);
    assertEq("a tournament without games gets no game section", rows(games) - (games.match(/sch-games-first/g) ?? []).length, withGames.length - 2);
    assertEq("game detail never changes which tournaments are included, or their order",
      [rows(only), rows(games), [...only.matchAll(/<h2 class="sch-name">([^<]+)/g)].map((m) => m[1]).join("|")],
      [withGames.length, withGames.length, [...games.matchAll(/<h2 class="sch-name">([^<]+)/g)].map((m) => m[1]).join("|")]);
    assertEq("status labels are identical in both versions",
      [...only.matchAll(/class="sch-status (sch-status-[a-z]+)"/g)].map((m) => m[1]).join(),
      [...games.matchAll(/class="sch-status (sch-status-[a-z]+)"/g)].map((m) => m[1]).join());
    assertEq("Include game schedule: a slim column-label row that repeats on printed pages",
      [/<thead><tr class="sch-colhead"><th scope="col">Dates<\/th><th scope="col">Tournament &amp; Games<\/th><\/tr><\/thead>/.test(games), /<thead/.test(only)], [true, false]);
    assertEq("games sit inside their tournament's cell, never as rows of their own",
      (games.match(/<tr class="sch-item/g) ?? []).length, withGames.length);
    assertEq("a tournament's heading and its first game day form one block",
      /<div class="sch-keep"><div class="sch-heading">[\s\S]*?<div class="sch-games sch-games-first">/.test(games), true);
    assertEq("the title and Updated date are the same in both", [/Tournament Schedule<\/h1>/.test(only), /Updated /.test(only), /Tournament Schedule<\/h1>/.test(games), /Updated /.test(games)], [true, true, true, true]);
    assertEq("the toolbar offers exactly the two choices, Tournaments only pressed by default",
      [...only.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`), ["Tournaments only:true", "Include game schedule:false"]);
    assertEq("...and Include game schedule pressed when chosen",
      [...games.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`), ["Tournaments only:false", "Include game schedule:true"]);
    assertEq("the choice is screen-only (inside the no-print toolbar)", /<div class="rpt-bar rpt-no-print">[\s\S]*rpt-detail[\s\S]*<article/.test(only), true);
    const css = fs.readFileSync(path.join(ROOT, "app", "reports", "tournament-schedule", "schedule.css"), "utf8");
    const print = css.slice(css.lastIndexOf("@media print"));
    assertEq("print: the column labels repeat, the heading + first day stay together, days never split",
      [/\.sch-table thead \{ display: table-header-group; \}/.test(print), /\.sch-row \.sch-keep \{ break-inside: avoid; \}/.test(print), /\.sch-row \.sch-day \{ break-inside: avoid; \}/.test(print)], [true, true, true]);
    assertEq("pagination rules are scoped to the game table (no global break rules)",
      /^\.sch-(keep|heading|day) \{ break-/m.test(css), false);
  }
  {
    const page = fs.readFileSync(path.join(ROOT, "app", "reports", "tournament-schedule", "page.js"), "utf8");
    const comp = fs.readFileSync(path.join(ROOT, "components", "reports", "TournamentScheduleReport.js"), "utf8");
    assertEq("?detail=games opens the expanded version; anything else is Tournaments only",
      /searchParams\?\.detail === "games" \? "games" : "tournaments"/.test(page), true);
    assertEq("the choice only updates this page's address — nothing is saved",
      [/window\.history\.replaceState/.test(comp), /fetch\(|localStorage|sessionStorage|use server|supabase/.test(comp)], [true, false]);
  }
  {
    const { tournamentScheduleReport } = require(path.join(ROOT, "lib", "queries", "reports", "tournament-schedule.js"));
    db = fakeDb({ seasons: [season], tournaments, games: games.map((x) => ({ ...x, game_type: "Pool", result: "W", runs_for: 5, notes: "private" })) });
    const rep2 = await tournamentScheduleReport(S);
    const allGames = rep2.tournaments.flatMap((t) => t.games);
    assertEq("the payload carries game type, never result, score or notes",
      [allGames.every((x) => x.gameType === "Pool"), JSON.stringify(rep2).includes("private"), /"result"|"runs_for"|"notes"/.test(JSON.stringify(rep2))], [true, false, false]);
  }

  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
