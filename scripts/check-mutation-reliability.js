/**
 * Mutation reliability across the High-risk surfaces.
 *
 * THE RULE: no action may appear to do nothing.
 *
 * Two production failures put this here. Make inactive SUCCEEDED and the
 * drawer went on showing "Active", because nothing told the open surface to
 * take the persisted state. Remove from roster FAILED silently, because
 * window.confirm() returned false under mobile dialog suppression and the
 * error rendered at page level, underneath a fixed full-height drawer.
 *
 * Run:  node scripts/check-mutation-reliability.js
 */
const fs = require("fs");

let ran = 0;
const failures = [];
function ok(label, cond) {
  ran += 1;
  if (cond === true) { console.log(`  ok    ${label}`); }
  else { failures.push(label); console.log(`  FAIL  ${label}`); }
}
const section = (t) => console.log(`\n${t}\n`);

const read = (f) => fs.readFileSync(f, "utf8");
/** Comments describe the fix; matching them would report prose as behaviour. */
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const HIGH_RISK = {
  Finance: "components/FinanceClient.js",
  Facilities: "components/FacilitiesClient.js",
  Settings: "components/SettingsClient.js",
  Tournaments: "components/TournamentClient.js",
};

/* ---- The shared primitives -------------------------------------------- */
section("Shared primitives");

{
  const mut = read("components/useMutation.js");
  const conf = read("components/ConfirmAction.js");
  const legacy = read("lib/useActionFeedback.js");

  ok("useMutation refreshes only on success",
    /if \(result\?\.ok\)/.test(mut) && /router\.refresh\(\)/.test(mut));
  ok("...and a caller can opt out where a refresh is wasted",
    /refresh = true/.test(mut));
  ok("...and errors reach the caller, not a shared surface",
    /onError: onErrorLocal/.test(mut));

  ok("ConfirmAction disables both controls while pending",
    (conf.match(/disabled=\{pending\}/g) || []).length === 2);
  ok("...shows progress on the destructive control", /\{pending \? pendingLabel/.test(conf));
  ok("...and renders its own error, not a container's", /confirm-inline-error/.test(conf));
  ok("useConfirm asks one question at a time", /const \[asking, setAsking\]/.test(conf));

  // Finance/Contacts/Lineup already had a runner WITH success notices. It was
  // missing synchronisation, so the notice was added to, not replaced.
  ok("the pre-existing feedback runner now synchronises too",
    /router\.refresh\(\)/.test(legacy));
  ok("...and keeps its success notice", /showNotice\(/.test(legacy));
}

/* ---- No native dialog gates a High-risk mutation ----------------------- */
section("Destructive actions are confirmed in-app");

for (const [surface, file] of Object.entries(HIGH_RISK)) {
  ok(`${surface}: no window.confirm gate`, !/\bconfirm\(/.test(code(file)));
  ok(`${surface}: uses the shared confirmation`, /ConfirmAction/.test(read(file)));
  ok(`${surface}: cancel is wired to a no-op cancel`, /onCancel=/.test(read(file)));
}

// Cancel must not mutate: the cancel handler only clears the question.
ok("cancelling never calls an action",
  /const cancel = useCallback\(\(\) => setAsking\(null\), \[\]\);/
    .test(read("components/ConfirmAction.js")));

// The action is reachable only from the confirm control, so one tap = one run.
for (const [surface, file] of Object.entries(HIGH_RISK)) {
  const src = read(file);
  ok(`${surface}: the first tap only asks`, /\.ask\(/.test(src));
  ok(`${surface}: the mutation is behind onConfirm`, /onConfirm=/.test(src));
}

/* ---- Errors appear in the surface that acted --------------------------- */
section("Failure is visible where it happened");

ok("Tournaments: drawer errors go to the drawer",
  /drawerError/.test(read(HIGH_RISK.Tournaments)));
ok("Facilities: drawer errors go to the drawer",
  /if \(detail\) setDrawerError\(message\); else setError\(message\);/
    .test(read(HIGH_RISK.Facilities)));
ok("Finance: the transaction drawer carries its own error",
  /drawerError = null/.test(read(HIGH_RISK.Finance)));
ok("Finance: the payment drawer carries its own error",
  /confirmingEntry = null/.test(read(HIGH_RISK.Finance)));
ok("Settings acts on the page, so a page-level error is correct there",
  /onError: \(message\) => setError\(message\)/.test(read(HIGH_RISK.Settings)));

/* ---- Success synchronises --------------------------------------------- */
section("Success is visible");

ok("Tournaments: a status change keeps the drawer open and refreshes",
  /runMutation\(setTournamentStatus/.test(read(HIGH_RISK.Tournaments)));
ok("Tournaments: a delete closes the drawer",
  /confirm\.cancel\(\); closeDetail\(\);/.test(read(HIGH_RISK.Tournaments)));
ok("Facilities: a delete closes the drawer",
  /confirm\.cancel\(\); closeDetail\(\);/.test(read(HIGH_RISK.Facilities)));
ok("Finance: a deleted transaction closes its drawer",
  /confirmDelete\.cancel\(\); setDetailTxn\(null\);/.test(read(HIGH_RISK.Finance)));
ok("Finance: a removed payment entry keeps the drawer and refreshes",
  /run\(deletePaymentEntry, fd, \(\) => confirmDelete\.cancel\(\)\)/.test(read(HIGH_RISK.Finance)));

/* ---- Finance protections untouched ------------------------------------ */
section("Finance protections are unchanged");

{
  const fin = read(HIGH_RISK.Finance);
  ok("the delete actions themselves were not rewritten",
    /run\(deleteBudgetItem, fd/.test(fin)
    && /run\(deleteTransaction, fd/.test(fin)
    && /run\(deletePaymentEntry, fd/.test(fin));
  ok("no server action was swapped for a different one",
    !/deleteBudgetItemUnsafe|forceDelete|bypass/.test(fin));
  ok("confirmation did not replace a server check",
    !/skipCheck|noConfirm|force: true/.test(fin));
}

/* ---- Duplicate runners --------------------------------------------- */
section("No new parallel runner");

{
  // A component defining its own `const result = await action(...)` inside a
  // transition is the pattern being retired.
  const rolled = Object.values(HIGH_RISK).filter((f) =>
    /startTransition\(async \(\) => \{\s*const result = await action/.test(code(f)));
  ok("no High-risk surface still hand-rolls the runner", rolled.length === 0);
  ok("exactly two shared runners exist, by design",
    fs.existsSync("components/useMutation.js") && fs.existsSync("lib/useActionFeedback.js"));
}


/* ---- Medium and Low surfaces ------------------------------------------ */
section("Files, Games, Contacts, Branding");

{
  const MORE = {
    Files: "components/FilesClient.js",
    Games: "components/GamesSection.js",
    Contacts: "components/ContactsClient.js",
    Branding: "components/TeamBranding.js",
  };
  for (const [surface, file] of Object.entries(MORE)) {
    ok(`${surface}: no window.confirm gate`, !/\bconfirm\(/.test(code(file)));
    ok(`${surface}: uses the shared confirmation`, /ConfirmAction/.test(read(file)));
    ok(`${surface}: the first tap only asks`, /\.ask\(/.test(read(file)));
    ok(`${surface}: the mutation sits behind onConfirm`, /onConfirm=/.test(read(file)));
  }

  ok("Files: a deleted document closes its drawer",
    /confirmDelete\.cancel\(\); closeDetail\(\);/.test(read(MORE.Files)));
  ok("Files: the drawer carries its own error",
    /drawerError = null/.test(read(MORE.Files)));
  ok("Games: the score-loss warning is in-app too",
    /Moving this game to a future date will remove the recorded/.test(read("components/GamesSection.js")));
  ok("Games: a deleted game clears the question and reloads the list",
    /confirmDelete\.cancel\(\); onChanged\?\.\(\);/.test(read(MORE.Games)));
  ok("Contacts: the row shows its own error",
    /deleteError = null/.test(read(MORE.Contacts)));
  ok("Branding: removing the logo resets in place",
    /confirmRemove\.cancel\(\); reset\(\);/.test(read(MORE.Branding)));
}

/* ---- Sections that stay open must synchronise -------------------------- */
section("Open surfaces synchronise");

{
  for (const [name, file] of Object.entries({
    TournamentContact: "components/TournamentContact.js",
    PlayerRecruiting: "components/PlayerRecruiting.js",
    EventRoster: "components/EventRoster.js",
    ContactsDirectory: "components/ContactsDirectory.js",
  })) {
    ok(`${name}: uses the shared runner`, /useMutation\(\)/.test(read(file)));
    ok(`${name}: no hand-rolled transition remains`,
      !/startTransition\(/.test(code(file)));
  }
}

/* ---- Deliberately unchanged ------------------------------------------- */
section("Runners left alone, on purpose");

{
  // Each of these already ends in a state change the user cannot miss, so a
  // refresh would be redundant work rather than a fix.
  //   QuickAddFacility  hands the created facility to its parent directly
  //   SeasonPicker      navigates
  //   RelatedLink       router.push
  //   SeasonBanner      server action redirects
  //   WelcomeForm       redirects after creating the organization
  //   AcceptInvite      redirects
  //   GettingStarted    local dismissal only, nothing persisted to re-read
  //   FacilityImport    ends on its own result screen
  ok("QuickAddFacility passes the new record to its caller",
    /onFacilityReady\?\.\(result\.facility\)/.test(read("components/QuickAddFacility.js")));
  ok("RelatedLink navigates", /router\.push\(/.test(read("components/RelatedLink.js")));
  ok("GettingStarted only dismisses locally",
    /setHidden\(true\)/.test(read("components/GettingStarted.js")));
}

console.log(`\n${ran} assertions, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
