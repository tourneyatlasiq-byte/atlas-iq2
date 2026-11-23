# Player dues schedules: package v5

## Status (2026-11-23, evening)
- DATABASE: the migration is ALREADY APPLIED to production, recorded as 20261123223848_player_dues_schedules. Do NOT run it again. Nothing in this package needs to be run in Supabase. v5 has no database changes.
- CODE: v4 (commit b6969ee) is deployed. v5 is NOT deployed yet. Deploying is a push to main from GitHub Desktop (see Install order).
- DATA: no schedule has been applied to any player. Chris's saved team schedule is NOT changed by this package. He corrects it himself in the app after v5 is live.

## What v5 adds over v4 (Chris still could not choose players)
Reproduced finding: Chris's team schedule is saved with ONE installment, Sep 1 $1,100, so it totals $1,100. His players owe $3,600, so no player matches and every checkbox is correctly disabled. Taps and selection work (the 390px touch test shows no reset). Why only one installment was saved is SUSPECTED, not confirmed: the new installment rows did not show a date on his phone in v4, so the extra rows may have been left out. That is a hypothesis from the saved data and his report, not something observed on his device.
1. If no player fits, the choose step says "No player can take this schedule. It totals $X, but most players owe $Y." with an Edit team schedule button.
2. Saving a team schedule whose total differs from what most players owe shows a warning on the same sheet before saving.
3. Every skipped player shows the reason beside the name. Exempt and $0 players show a muted grey "Skipped: Exempt. Owes no dues." (neutral, not red). Players who owe a different total show a red "Not selectable: Owes $3,000.00, not $3,600.00. Needs its own schedule."
4. Select all adds the eligible players to whatever is already selected. It no longer replaces the selection. Clear still empties it.
5. A new installment row starts with a date: the first of the month after the last dated row (Dec 2026 gives Jan 2027, Jan 31 gives Feb 28), or today when there are no dated rows.
6. The "team schedule saved" toast is now a banner inside the sheet. The toast covered the lower player rows for a few seconds, which could block taps.
7. Footer buttons: Cancel, Save, and a primary "Save and continue" that goes straight to choosing players.
Chris's fix once v5 is live: Team schedule, enter Sep 1 $1,100 and Oct 1, Nov 1, Dec 1, Jan 1, Feb 1 at $500 each (total $3,600.00), Save and continue, choose players, review. Existing recorded payments count automatically.

## What v4 adds over v3
1. Team schedule, choosing players (Chris could not find it): Finance now has an "Apply schedule to players" button whenever a team schedule exists, so nobody has to re-save the template to reach it. The step is labeled "Step 1 of 2 Choose players" and the review "Step 2 of 2". Every player is listed. Exempt, $0-dues and different-total players are dimmed with the reason (for example "Owes $3,000.00, not $3,600.00. Needs its own schedule."). Select all and Clear controls; individual select and deselect work. Plain Save now says where to go next.
2. Player overview: Season dues, Payments received, Remaining balance. "Partly paid" replaces "Partial" on the pill (display only, stored value unchanged). Payment schedule shows "No payment dates set." and one "Add payment schedule" button (or installments with "Edit schedule"). "Payments received" lists the history. The long paragraph, the duplicate footer schedule button and the "actual payments" label are gone. Record payment is unchanged.
3. Schedule editor: Season dues, "Payments already received" (read only, "Existing payments count automatically toward this schedule."), installment rows in the app's rounded field style, "+ Add installment", "Schedule total", and a live preview of what the received money covers. Save schedule stays disabled when a new schedule is empty or does not match season dues.

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
2. In GitHub Desktop, expect 7 changed files, the ones that differ from v4 (DUES_SCHEDULES_REVIEW.md, app/volt.css, components/DuesSchedule.js, components/FinanceClient.js, scripts/check-dues-select-step.js, scripts/e2e/dues-select-390.js and the new scripts/e2e/dues-editor-390.js); the rest of the package is identical to v4. Do not commit app/layout.js, app/robots.js or app/sitemap.js (unrelated website edits). Commit and push to main.
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
- v5 final run: 108 check scripts in the chain pass (surface-options baseline skipped), select-step source check 24/24, database 94/94, real-helper permissions 42/42 (fresh database), screen tests 109/109, 390px touch selection test 20/20 (tap checkbox, tap name, deselect, Select all, Clear, review carries exactly the chosen players, nothing applied), 390px editor test 17/17 (six dates and amounts visible and editable, nothing covered, keyboard-height viewport, December to January month advancement, nothing saved), production build passes.
- v4 final run: 108 check scripts in the chain pass (surface-options baseline skipped), new select-step source check 17/17, database 94/94, real-helper permissions 42/42 (fresh database), screen tests 109/109, 390px team selection end to end 16/16, production build passes. Screenshots of the overview and editor were reviewed at 390px in a local demo database.
- v3 final run: record payment source check 13/13, rules 80/80, wiring 26/26, database 94/94, real-helper permissions 42/42, screen tests 109/109, 390px end-to-end $500 test 14/14, build passes.
- v2 notes: rules 80/80, wiring 26/26, database 94/94, real-helper permissions 42/42. Mutation checks confirmed the tests catch: missing total trigger, missing version check, missing row lock, missing revision check, open read policy, missing season check
- check-dues-edit 44, check-dues-filter 91, org-context 17 and 70, conventions, migrations, syntax (435 files) all pass; production build passes
- Browser (390px and 1280px) against a local demo database (fictional players, Chris's schedule): list chips, Past due count, team schedule sheet, apply select and review (ink checkboxes), a team schedule edit between review and apply (refused, 0 written), simplified drawer, editor opening on fresh figures after a payment landed, day change at midnight (Nov 30 to Dec 1: On schedule to Due today) and resume (Dec 3: Past due, tile 7 to 8). Payment log unchanged after apply (13 rows, $13,500).

## Not verified
- Supabase's own token verification (their code; the helpers that consume it were tested as production defines them)
- Deployed behavior: v5 code has been tested only against a local demo database. It must be verified in Test Organization after deployment (the live site cannot show unpublished changes)
- A real phone keyboard (simulated by shrinking the viewport to 390x520). The date pickers on a real phone were not exercised
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
