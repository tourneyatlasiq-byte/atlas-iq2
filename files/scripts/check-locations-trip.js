// Locations & Resources: the trip block must use the one shared featured-tournament rule,
// search must come first and exist once, and filters must be written back to the URL.
const fs = require("fs");
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log("  FAIL  " + m); } else console.log("  ok    " + m); };
const client = fs.readFileSync("components/FacilitiesClient.js", "utf8");
const block = fs.readFileSync("components/LocationsNextTournament.js", "utf8");
const page = fs.readFileSync("app/(app)/facilities/page.js", "utf8");

ok(/featuredTournament\(tournaments, today\)/.test(client), "page features the trip with the shared rule on the device date");
ok(/useLocalToday\(serverToday\)/.test(client), "device calendar date, not UTC");
ok((client.match(/className="toolbar-search/g) || []).length === 1, "exactly one Locations search box");
ok(client.indexOf('className="lr-search"') < client.indexOf("<LocationsNextTournament"), "search comes before the trip block");
ok(/history\.replaceState/.test(client) && /detail\?\.id/.test(client), "search and filters are written to the URL, and re-written after a place opens or closes");
ok(/lockTo=\{\{ kind: "tournament"/.test(block), "upload attaches to the featured tournament");
ok(!/defaultValue="[^"]+"/.test(fs.readFileSync("components/DocumentUpload.js", "utf8").split('id="up-category"')[1].split("</select>")[0]), "file category is never preselected");
ok(/listSeasonTournaments/.test(page) && /serverToday=/.test(page), "page loads season tournaments and passes the server date");
ok(/featured \? "btn-secondary" : "btn-primary"/.test(client), "Add location steps back while Directions is the single Volt action");
const upload = fs.readFileSync("components/DocumentUpload.js", "utf8");
const guides = fs.readFileSync("lib/help-guides.js", "utf8");
ok(!/sensitive-warning|Don.t upload highly sensitive/.test(upload), "upload form has no sensitive-information box");
ok(/Don't upload highly sensitive information/.test(guides), "the sensitive-information guidance lives in Help (Files guide)");
ok(!/Would use again: \{wouldUseAgainLabel\(wua\)\}/.test(client) || /\["yes", "no"\]\.includes\(f\.orgNotes\?\.would_use_again\)/.test(client), "cards show Would use again only for a real answer");
ok(/n\.would_use_again === "yes" \|\| n\.would_use_again === "no"/.test(client), "drawer hides the Would use again row when not rated");
ok(/lr-views .segment, html:root .lr-types .segment \{ min-height: 44px/.test(fs.readFileSync("app/volt.css", "utf8")), "filters are 44px on phones");
console.log(`\n${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);
