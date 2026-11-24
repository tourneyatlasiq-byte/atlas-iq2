/**
 * Adding a person from the Team page must show them straight away, every time.
 *
 * Root cause found in testing (13 of 50 repeated saves stalled): the save
 * handler called closeDetail() even when no drawer was open. With no drawer,
 * that navigates to the page's own address while useMutation's router.refresh()
 * is fetching the new roster; the two raced and the page could keep the old
 * list until the next save. The guard `if (detail) closeDetail()` removes the
 * redundant navigation. This is a source-level guard (the same style as the
 * other check scripts); the behaviour itself was verified in a real browser.
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "components", "RosterClient.js"), "utf8");
const mut = fs.readFileSync(path.join(__dirname, "..", "components", "useMutation.js"), "utf8");

let failed = 0;
const ok = (label, cond) => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${label}`); if (!cond) failed++; };

const start = src.indexOf("function submitEdit(");
const end = src.indexOf("function toggleActive(");
const body = start >= 0 && end > start ? src.slice(start, end) : "";
ok("submitEdit found", body.length > 0);
const stripped = body.replace(/\/\/.*$/gm, "");
ok("closes the drawer only when one is open", /if \(detail\) closeDetail\(\)/.test(stripped));
ok("no unconditional closeDetail() in submitEdit", !/(^|[;{}\n])\s*closeDetail\(\);/.test(stripped.replace(/if \(detail\) closeDetail\(\);/g, "")));
ok("the page still refreshes after a successful save (useMutation)", /router\.refresh\(\)/.test(mut));

console.log(`\n${failed ? "FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);
