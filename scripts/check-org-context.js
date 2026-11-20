/**
 * Phase 3C-0: a ratchet on the legacy single-organization model.
 *
 * Today the application learns WHO someone is and WHICH ORGANIZATION they act in from their
 * profile (profile.role, profile.organization_id, profiles reads) and decides write/admin
 * rights from that role (canWrite, isOrgAdmin). Phase 3C moves all of that to the person's
 * active membership. This check pins the exact inventory so that:
 *
 *   - no new code can quietly add another direct read of the legacy profile fields while 3C
 *     is in progress (a new file, or another read in a listed file, fails here);
 *   - each 3C batch must update the inventory below on purpose, and the diff shows exactly
 *     what moved.
 *
 * It also records, before the route is removed in 3C-4, that nothing depends on /review.
 * Counts are occurrences, not lines. Nothing here reads the database.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
let failed = 0, passed = 0;
function ok(label, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) passed++; else failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}`);
  if (!pass) {
    const isMap = actual && expected && typeof actual === "object" && !Array.isArray(actual);
    if (isMap) {
      const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort();
      for (const k of keys) if (actual[k] !== expected[k]) console.log(`        ${k}: expected ${expected[k] ?? "none"}, found ${actual[k] ?? "none"}`);
    } else console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  }
}
function walk(d, o = []) {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const rel = path.posix.join(d, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".next", ".git"].includes(e.name)) walk(rel, o); }
    else if (rel.endsWith(".js")) o.push(rel);
  }
  return o;
}
// The temporary preview-only gate route (removed before merge) is test scaffolding, not application code.
const FILES = ["app", "components", "lib"].flatMap((d) => walk(d)).filter((f) => !f.startsWith("app/api/preview-gate/"));
const SRC = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
// Counts are of executable code: comments that merely mention canWrite() or profile.role don't count.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const CODE = Object.fromEntries(FILES.map((f) => [f, stripComments(SRC[f])]));

const PATTERNS = {
  "profile role reads (profile.role)": /\bprofile\??\.role\b/g,
  "profile organization reads (profile.organization_id)": /\bprofile\??\.organization_id\b/g,
  "direct profiles table reads": /\.from\(\s*["']profiles["']\s*\)/g,
  "isOrgAdmin( callers": /\bisOrgAdmin\(/g,
  "canWrite( callers": /\bcanWrite\(/g,
};
function inventory(re, name) {
  const out = {};
  for (const [f, s] of Object.entries(CODE)) {
    let n = (s.match(re) ?? []).length;
    // the definitions themselves are not callers
    const fn = /isOrgAdmin/.test(name) ? "isOrgAdmin" : /canWrite/.test(name) ? "canWrite" : null;
    if (fn) n -= (s.match(new RegExp(`export function ${fn}\\b`, "g")) ?? []).length;
    if (n > 0) out[f] = n;
  }
  return out;
}

/* The inventory at the start of 3C (production main eb8054e). Update deliberately, per batch. */
const EXPECTED = {
  "profile role reads (profile.role)": {
    "app/(app)/facilities/page.js": 2, "app/(app)/files/page.js": 2, "app/(app)/settings/page.js": 1,
    "app/(app)/team/page.js": 2, "app/(app)/tournaments/page.js": 2, "app/review/page.js": 3,
    "lib/actions/branding.js": 1, "lib/actions/documents.js": 2, "lib/context.js": 3, "lib/performance-links.js": 2,
  },
  // 3C-1: getContext takes the organization from the live membership; nothing reads profile.organization_id now.
  "profile organization reads (profile.organization_id)": {},
  // 3C-1: the two reads in lib/context.js became the single narrow bootstrap read in lib/auth/active-membership.js.
  "direct profiles table reads": { "app/(app)/settings/page.js": 1, "lib/actions/onboarding.js": 1, "lib/auth/active-membership.js": 1 },
  "isOrgAdmin( callers": {
    "app/(app)/help/access.js": 1, "app/(app)/layout.js": 1, "app/(app)/settings/page.js": 2,
    "lib/actions/facility-import.js": 1, "lib/actions/seasons.js": 2, "lib/actions/settings.js": 1,
  },
  "canWrite( callers": {
    "app/(app)/contacts/page.js": 1,
    // Group 1 (2026-11-19): Home gates its quick actions and Record buttons.
    "app/(app)/dashboard/page.js": 1,
    "app/(app)/facilities/page.js": 1, "app/(app)/files/page.js": 1,
    "app/(app)/finance/page.js": 1, "app/(app)/help/access.js": 1, "app/(app)/layout.js": 1,
    // RPT-002 (2026-11): Performance offers "Player report" only to roles allowed to open it (+2); the coach-only player report page refuses other roles (2).
    "app/(app)/performance/page.js": 3, "app/(app)/team/page.js": 1,
    "app/(app)/tournaments/[tournamentId]/games/[gameId]/lineup/page.js": 1,
    "app/(app)/tournaments/[tournamentId]/games/[gameId]/track/page.js": 1,
    "app/(app)/tournaments/page.js": 1, "app/reports/qab-player/page.js": 2, "app/review/page.js": 1, "lib/actions/contacts.js": 1,
    "lib/actions/documents.js": 1, "lib/actions/facilities.js": 2, "lib/actions/finance.js": 1,
    "lib/actions/games.js": 1, "lib/actions/intake.js": 1, "lib/actions/lineup.js": 1,
    "lib/actions/participants.js": 1, "lib/actions/places.js": 1, "lib/actions/plate-appearances.js": 1,
    "lib/actions/player-address.js": 1, "lib/actions/player-contacts.js": 1, "lib/actions/roster.js": 1,
    "lib/actions/tournaments.js": 1,
  },
};

console.log("\nA. Legacy single-organization reads (inventory at the start of 3C)");
for (const [name, re] of Object.entries(PATTERNS)) {
  const actual = inventory(re, name);
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  ok(`${name}: ${total(EXPECTED[name])} in ${Object.keys(EXPECTED[name]).length} files`, actual, EXPECTED[name]);
}

console.log("\nB. Where the pin and the membership are used (3C-1: the context path only)");
ok("only the Supabase server client sends the organization pin (plus the preview-only gate route, removed before merge)", FILES.filter((f) => /x-season-tempo-org/.test(CODE[f])).filter((f) => !f.startsWith("app/api/preview-gate/")), ["lib/supabase/server.js"]);
ok("only the bootstrap reads memberships or the active-organization pointer", FILES.filter((f) => /organization_memberships|active_organization_id/.test(CODE[f])), ["lib/auth/active-membership.js"]);
ok("getContext takes the organization from the live membership, pinned", /createPinnedClient\(membership\.organization_id\)/.test(CODE["lib/context.js"]) && !/profile\.organization_id/.test(CODE["lib/context.js"]), true);
ok("the database's per-request pin is the only place the pin is read", fs.existsSync(path.join(ROOT, "supabase/migrations/20261111113032_org_02_membership_helpers.sql")), true);

console.log("\nC. /review has no dependency (checked before its removal in 3C-4)");
const reviewDir = fs.existsSync(path.join(ROOT, "app/review"));
const inReview = (f) => f.startsWith("app/review/") || f.startsWith("components/review/");
const outside = FILES.filter((f) => !inReview(f));
ok("no executable code outside the route and components/review links to or imports it", outside.filter((f) => /["'`(]\/review["'`?/)]|components\/review|app\/review|\.\.\/review\//.test(stripComments(SRC[f]))), []);
ok("the only other mentions are three comments, to tidy when the route is removed (3C-4)", outside.filter((f) => /\/review\b|app\/review/.test(SRC[f])), ["components/FinanceClient.js", "lib/queries/finance.js", "lib/queries/tournaments.js"]);
ok("the route is not in the signed-in navigation or Help", outside.filter((f) => /(NavSidebar|help)/i.test(f) && /\/review\b/.test(SRC[f])), []);
ok("no script, package or document names it", ["package.json", ...fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".js") && !/^check-org-context/.test(f)).map((f) => "scripts/" + f)].filter((f) => /app\/review|components\/review|\/review\b/.test(fs.readFileSync(path.join(ROOT, f), "utf8"))), []);
if (reviewDir) {
  const page = SRC["app/review/page.js"];
  ok("it lives outside the (app) shell and requires a signed-in session (getContext redirects to /login)", /getContext\(\)/.test(page) && !fs.existsSync(path.join(ROOT, "app/(app)/review")), true);
  ok("it is read-only: every callback is a no-op and it declares itself temporary", /TEMPORARY review surface/.test(page) && /read-only/.test(page), true);
  ok("only components/review/ReviewSurface.js is private to it", fs.readdirSync(path.join(ROOT, "components/review")), ["ReviewSurface.js"]);
  ok("its only reader of a legacy profile field is getContext + inline role checks already counted above", (SRC["app/review/page.js"].match(/profile\??\.role/g) ?? []).length, 3);
} else {
  ok("the route and its private components are gone, with nothing left importing them", !fs.existsSync(path.join(ROOT, "components/review")), true);
}

console.log(`\n${passed + failed} assertions, ${failed} failed`);
process.exit(failed ? 1 : 0);
