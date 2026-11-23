# Player dues schedules: package v3

## Status (2026-11-23, 17:52)
- DATABASE: the migration is ALREADY APPLIED to production, recorded as 20261123223848_player_dues_schedules. Do NOT run it again. Nothing in this package needs to be run in Supabase.
- CODE: v3 is NOT deployed yet. Deploying is a push to main from GitHub Desktop (see Install order).
- DATA: no schedule has been applied to any player. dues_installments and dues_schedule_templates are empty.
- Verified read only after the migration: player_payments 55 records / $152,000.00, payment_log 94 payments / $73,810.00, player_payment_operations 4 / $86.00. Same counts and totals as before the migration.

## What v3 adds over v2
Record payment fix found with Chris (details at the end): the amount field starts empty, Full balance is one tap, the sheet shows Remaining balance and what is left after the entered amount, and the Home and Finance buttons read Record payment. The migration file in this package is renamed to the recorded version; its contents are unchanged and match what was applied.

## Changes in v2 (review findings, included in v3)
1. Apply now carries the team schedule revision that was reviewed. The database locks the schedule row (for share), compares, and refuses a stale review with nothing written (code template_changed). A replay of an already applied request still reports 'already applied'. Two-connection tests: edit in progress while applying, apply in progress while editing, sequential stale, replay after the schedule moved on, missing revision.
2. The player editor now starts from one database call (dues_player_snapshot, a STABLE function) that returns total, exempt, paid, active schedule AND version together. The form no longer reads amounts from the page behind it. Tests: values and version agree, a change after page load shows up with its new version, an older version is refused, a payment landing after the editor opened refuses the save. loadDuesVersion was removed.
3. Drawer: the old Total/Paid/Balance block is hidden when the schedule summary shows. The drawer button now reads 'Record payment' (no amount).
4. Permissions re-tested with the REAL production sign-in helpers (definitions copied read only from production on 2026-11-23; fixture-real-helpers.sql, run-real-helpers.js, 42 checks): cross-organization, cross-team inside one organization, a coach whose active organization is another one, no membership, linked and unlinked parents, anon, direct table writes, row level security reads. Desktop width and day-change/app-resume were checked in a live browser.

Exempt and zero-dues players stay skipped (preview and apply refuse them). Existing payments and schedule history are untouched.


## Install order
1. Copy this package over the repo (File Explorer, overwrite). It carries the migration under its recorded name 20261123223848_player_dues_schedules.sql. If an older copy named 20261124000000_player_dues_schedules.sql exists in supabase/migrations, delete it so the repo has one copy. Do not run any SQL.
2. In GitHub Desktop, expect 29 changed files. Do not commit app/layout.js, app/robots.js or app/sitemap.js (unrelated website edits). Commit and push to main.
3. After deployment, a partial payment is verified in Test Organization (Test Name 16U) first.
4. Nothing is applied to any real player until the player-by-player allocation preview is reviewed and approved. Exempt and zero-dues players stay skipped.

## What it does
- Chris enters each installment's date and exact dollar amount (Sep 1 2026 $1,100; Oct 1 to Feb 1 $500 each; total $3,600). No percentages.
- Applying previews recorded payments (actual) versus the calculated coverage, oldest unpaid installment first. Applying only writes installments. It never creates, changes or deletes a payment.
- Past due = unpaid on installments dated before today. Due today counts as due; past due starts the next day.
- "Next scheduled payment" is always a separate tile from Past due. Upcoming and the tile use Volt tokens, no blue.
- Players with other totals or arrangements get their own editable schedule (Schedule and total sheet). Total and schedule save together or not at all.

## Exempt rule
A player with recorded payments cannot be marked exempt. An exempt player with no payments has the schedule superseded (kept as history, reason exempt). Payment and schedule history are never deleted.

## Concurrency
Row locks plus an explicit version check (md5 of total, exempt, payments and active installments). Verified with two-connection tests: payment vs schedule edit, schedule edit vs payment, bulk apply vs payment, two edits on one version, same bulk request twice, undo.

## Schedule-total rule
Active installments must equal total dues, enforced at commit by the database for installment changes and for total changes, so the combined save succeeds while a partial one is refused.

## Dates
v1 uses the device date. Refreshes at local midnight, on resume and on focus; neutral "loading" until the date is known. Limitation: devices in different time zones can disagree for a few hours around midnight. A stored organization time zone is needed before reports or reminders.

## Test results
- v3 final run: record payment source check 13/13, rules 80/80, wiring 26/26, database 94/94, real-helper permissions 42/42, screen tests 109/109, 390px end-to-end $500 test 14/14, build passes.
- v2 notes: rules 80/80, wiring 26/26, database 94/94, real-helper permissions 42/42. Mutation checks confirmed the tests catch: missing total trigger, missing version check, missing row lock, missing revision check, open read policy, missing season check
- check-dues-edit 44, check-dues-filter 91, org-context 17 and 70, conventions, migrations, syntax (435 files) all pass; production build passes
- Browser (390px and 1280px) against a local demo database (fictional players, Chris's schedule): list chips, Past due count, team schedule sheet, apply select and review (ink checkboxes), a team schedule edit between review and apply (refused, 0 written), simplified drawer, editor opening on fresh figures after a payment landed, day change at midnight (Nov 30 to Dec 1: On schedule to Due today) and resume (Dec 3: Past due, tile 7 to 8). Payment log unchanged after apply (13 rows, $13,500).

## Not verified
- Supabase's own token verification (their code; the helpers that consume it were tested as production defines them)
- Deployed behavior: v3 code has been tested only against a local demo database, not yet on the live site or in Test Organization
- A real phone keyboard (simulated by shrinking the viewport)
- Real parent accounts end to end in the app (database level parent access is tested)
- Day change on a real phone left open overnight (simulated with a controlled browser clock)

## Flags
- check-surface-options.js fails at the untouched baseline (missing supabase/pending/surface_options.sql). Pre-existing, left alone, so npm run check stops there; the remaining scripts were run individually.
- One new deferred trigger on player_payments (total and exempt changes), dues_player_payments_total. Applied with the migration and verified present beside season_write_policy.
- Baseline edits to check-org-context and check-org-context-3c1 and fake-client updates in check-dues-edit and check-dues-filter are listed in the diff.
- Not built (deferred as agreed): dashboard "players past due" card.
- Excluded from this ZIP: unrelated uncommitted www edits (layout, robots, sitemap).
- Finance home 'Collect $X from [player]' and the Dashboard rows now say Record payment (v3), matching the drawer.


## Record payment fix (found with Chris, 2026-11-23)
Cause: the Record payment sheet opened with the whole balance already typed in the field. On a phone, tapping it puts the cursor at the end, so typing 500 produced 2100.00500 and a button reading Record $2,100.01. Every label also showed the full balance, so it looked as if only the full balance could be recorded.
Fix (components/RecordPaymentSheet.js): the amount starts empty ("Amount to record"); Full balance and Half are one tap; focusing the field selects its contents so typing replaces; the sheet shows Remaining balance and, separately, "$1,600.00 left after this payment"; the date field stays. The Home and Finance buttons now read Record payment instead of Record $balance. Payment rules, idempotency and the database function are unchanged.
Verified at 390px with a real tap, real keystrokes and a shrunken viewport for the keyboard: $500 recorded against $2,100 gives exactly one $500.00 payment and $1,600.00 left; Save stays visible above the keyboard.
