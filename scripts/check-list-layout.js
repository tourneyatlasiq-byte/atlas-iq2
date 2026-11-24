/**
 * Comparison lists (2026-11-23): Tournament list columns and cards, "Considering cost" wording,
 * alternating rows (Tournaments, Team roster, Budget categories) and the Finance Past due tile.
 * Source checks only; the visual result is reviewed from screenshots.
 */
const fs = require("fs");
const read = (f) => fs.readFileSync(f, "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
let ran = 0, failed = 0;
function ok(label, cond) { ran += 1; if (!cond) { failed += 1; console.log(`  FAIL  ${label}`); } else console.log(`  ok    ${label}`); }
const tc = strip(read("components/TournamentClient.js"));
const fin = read("components/FinanceClient.js");
const css = read("app/volt.css");

const head = tc.slice(tc.indexOf('className="tl-head"'), tc.indexOf('className="tl-head"') + 700);
ok("desktop headings are Dates, Tournament / location, Registration, Payment, Cost, Action in that order",
  ["Dates", "Tournament / location", "Registration", "Payment", "Cost", "Action"].map((w) => head.indexOf(`>${w}<`)).every((i, k, a) => i > -1 && (k === 0 || i > a[k - 1])));
ok("rows do not repeat the decision (Committed or Considering) as a chip", !/StatusFacets t=\{t\}[^]*?className="t-row tl-row/.test(tc) && !/f\.decision/.test(tc));
ok("each card labels Registration, Payment and Cost in that order", (() => {
  const row = tc.slice(tc.indexOf('className="tl-cell tl-reg"'));
  const r = row.indexOf(">Registration<"), p = row.indexOf(">Payment<"), c = row.indexOf(">Cost<");
  return r > -1 && p > r && c > p;
})());
ok("row words come from the shared status rules", /statusFacets\(t, transactions\)/.test(tc) && /<QuickButton/.test(tc));
ok("the cost shown is unchanged (money of total_cost)", /money\(t\.total_cost\)/.test(tc));
ok("the row is still one clickable button that opens the tournament", /<button className="t-main tl-main" onClick=\{\(\) => openDetail\(t\)\}>/.test(tc));
ok("past rows keep their class and Needs action markers", /t-row-past/.test(tc));
ok("the card is named Considering cost (not Potential cost) and says it is Considering only and not in committed cost", />Considering cost</.test(tc) && !/>Potential cost</.test(tc) && /considering, not in committed cost/.test(tc) && /Declined tournaments are not included/.test(tc));
ok("Considering cost reports Considering tournaments with no cost entered", /consideringNoCost/.test(tc) && /with no cost entered/.test(tc));
ok("calculation is untouched (potentialCost still comes from the shared rule)", /summary\.potentialCost/.test(tc));
ok("phone cards: column heading row hidden, action full width", /\.tl-head \{ display: none; \}/.test(css) && /\.tl-row \.tl-act \.btn \{ width: 100%/.test(css));
ok("alternating rows for the tournament list", /\.t-row\.tl-row:nth-child\(odd\) \{ background: var\(--zebra\)/.test(css));
ok("alternating rows for the roster", /\.roster-table tbody tr:nth-child\(even\) \{ background: var\(--zebra\)/.test(css));
ok("alternating rows for budget categories", /\.budget-board > :nth-child\(odd\):not\(\.budget-colhead\)/.test(css));
ok("the roster Uniform heading is one line", /\.roster-table th \.th-sub \{ position: absolute/.test(css));
ok("the budget column heading row is not shown on phones", /max-width: 900px\) \{ html:root \.budget-board \.budget-colhead \{ display: none/.test(css));
ok("zebra colours are Volt neutrals (no blue)", /--zebra: #eff2f6/.test(css));

const tile = fin.slice(fin.indexOf("function pastDueState"), fin.indexOf("function PastDueTile"));
ok("the third Finance tile is the Past due tile, not Collect", /<PastDueTile/.test(fin) && !/NextAction/.test(fin) && !/Collect \$\{money/.test(fin));
ok("the Past due button opens Player Dues with the Past due filter selected", /setDuesViewRequest\(\{ view: "pastdue"/.test(fin) && /goToTab\("payments"\)/.test(fin) && /viewRequest=\{duesViewRequest\}/.test(fin) && /setView\(viewRequest\.view\)/.test(fin));
ok("phones get a compact Past due summary above the section list", /<PastDueCompact/.test(fin) && /\.fin-m-overview \.fin-m-pastdue/.test(css));
ok("the total is labeled as scheduled players only when some players have no schedule", /Past due among scheduled players/.test(fin) && /none > 0 && scheduled > 0/.test(fin));
ok("it uses the shared dues rules", /standingForRecord\(/.test(tile) && /summarizeDues\(/.test(tile));
ok("it waits for the device date", /!today/.test(tile) && /Checking dates/.test(tile));
ok("it never derives past due from a balance", !/\.balance/.test(tile));
ok("without schedules it shows a setup state with the count of players with no schedule", /No payment schedules yet/.test(tile) && /noScheduleCount/.test(tile) && /players have/.test(tile) && /no schedule/.test(tile));
ok("setup opens the team schedule sheet for people who can write", /kind: "setup"/.test(tile) && /canWrite/.test(tile) && /setTeamScheduleOpen\(true\)/.test(fin));
ok("Record payment remains in Player Dues", /onClick=\{\(\) => onRecord\(p\)\}|Record payment/.test(fin) && /setPaying\(/.test(fin));
console.log(`${ran - failed}/${ran} checks passed`);
process.exit(failed ? 1 : 0);
