/**
 * Season tempo (timeline) guards, 2026-11-22. Source-level, no browser.
 * The behaviour itself (hover, click, tap, clusters, no sideways scroll) was
 * exercised on the real component in a browser at 1280, 390 and 360 wide.
 * Run: node scripts/check-season-strip.js
 */
const fs = require("fs");
const r = (f) => fs.readFileSync(f, "utf8");
const strip = r("components/SeasonStrip.js"), volt = r("app/volt.css"), tc = r("components/TournamentClient.js"), st = r("lib/tournament-status.js");
let n = 0, bad = 0;
const eq = (name, v) => { n++; if (!v) bad++; console.log(`  ${v ? "ok  " : "FAIL"}  ${name}`); };

eq("no 'no start and end dates' note: the line never implies season dates", !/no start and end dates/.test(strip));
eq("season dates are used only when both exist; otherwise whole months of the tournaments", /season\?\.start_date && season\?\.end_date/.test(strip) && /monthRange\(beats, today\)/.test(strip));
eq("compact by default, choice remembered in a guarded localStorage", /useState\(false\)/.test(strip) && /try \{ localStorage\.setItem/.test(strip) && /try \{ setExpanded\(localStorage/.test(strip));
eq("dots that would touch merge, repeatedly, so none overlap", /for \(let again = true; again;\)/.test(strip) && /clusterBeats\(/.test(strip));
eq("hover and focus tooltip shows name, dates, place and status", /className="st-tip"/.test(strip) && /placeOf\(t\)/.test(strip) && /statusOf\(t, transactions\)/.test(strip));
eq("mouse click opens the tournament; a tap shows details with Open first", /canHover && c\.items\.length === 1 && onOpen/.test(strip) && /Open<\/button>/.test(strip));
eq("Tournaments page opens the drawer in place; Home falls back to a link", /onOpen=\{\(t\) => openDetail\(t\)\}/.test(tc) && /href=\{`\/tournaments\?open=\$\{t\.id\}`\}/.test(strip));
eq("Commit and Register share the primary style; only Paid is secondary", /quickAction\(t\)\?\.kind === "paid" \? "secondary" : "primary"/.test(tc));
eq("a Considering tournament's status text includes its registration", /Not in Budget\$\{reg\}/.test(st));
eq("timeline styles live in volt.css and keep 40px tap targets", /html:root \.st-beat \{[^}]*width: 40px; height: 40px/.test(volt) && /html:root \.st-tempo-toggle \{[^}]*min-height: 40px/.test(volt));
eq("Performance screen also leaves out the per-game dots", /showDots=\{false\}/.test(r("components/PerformanceSeason.js")));
eq("one shared status mapping: Decision, Registration, Payment", /export function statusFacets/.test(st) && /statusWords/.test(strip) && /StatusFacets/.test(tc) && /Payment/.test(r("components\/StatusFacets.js".replace("\\",""))));
eq("player QAB report leaves out the per-game dots", /showDots=\{false\}/.test(r("components/reports/QabPlayerReport.js")));

console.log(`\n${n - bad}/${n} passed${bad ? `, ${bad} FAILED` : ""}\n`);
process.exit(bad ? 1 : 0);
