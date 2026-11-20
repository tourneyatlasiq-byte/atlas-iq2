# RBI QAB reason: release runbook (nothing below has been run in production)

## Short version
1. Apply supabase/migrations/20261120213000_qab_rbi_reason.sql, then verify it (section 1).
2. Upload and deploy the application files from this package (section 2).
3. In Test Organization verify RBI recording, editing, offline sync, and the Season, Tournament and Player reports (section 3).
4. After release, reload any open tracker (tell coaches to reload the tracker). A tab left open from before the release can show RBI at-bats wrongly on screen until it is reloaded. Saved data is never affected.

The migration already sits in its permanent location, so there is no separate bookkeeping commit. If an earlier RBI zip was unpacked, delete supabase/pending/qab_rbi_reason.sql.

Order is fixed: migration first, application second, live checks third. Each step needs Autumn's explicit go.

## 0. Before starting
- The application commit to deploy is the one that contains the reviewed package (the single RBI package). Record its full SHA here before step 1: `______`. Step 2 deploys exactly that SHA.
- Pick a quiet window: no game being tracked live (an open older tab is safe for data, see Compatibility, but should not be mid-game).
- `npm run check` exit 0 on that commit (reviewed run: 2026-11-20, exit 0). The production-font build is PENDING (step 2).

## 1. Apply and verify the widening constraint (supabase/migrations/20261120213000_qab_rbi_reason.sql)
Before (read-only, project iiyuagxdeafkxrtixktr):
1. `select pg_get_constraintdef(oid) from pg_constraint where conname='pa_reasons_allowed';` expect the eight keys, no 'rbi'.
2. `select count(*), md5(string_agg(id::text||qab_reasons::text, ',' order by id)) from plate_appearances;` write the two values down.
3. `select count(*) from plate_appearances where 'rbi' = any(qab_reasons);` expect 0 (it cannot be anything else).
Apply: the statement in that file, as a named migration called qab_rbi_reason (brief lock on a few hundred rows). The version Supabase records is the apply time, which may differ from the timestamp in the file name; that is harmless.
After (read-only):
4. Constraint definition lists exactly: hit, walk, hbp, hard_hit, eight_pitch, situation_success, sac_bunt, sac_fly, rbi.
5. Same count and md5 as step 2 (no row changed).
6. `pa_one_reason` still present (`cardinality(qab_reasons) <= 1`); trigger `trg_normalize_qab_reasons` and view `qab_reason_tournament` still present.
7. `get_advisors` security: no new warning.
Stop and report if any of 4 to 6 differs.
Rollback (only while no RBI row exists): re-add the eight-key constraint. It fails if any row holds 'rbi'.

## 2. Deploy the exact reviewed commit
1. Deploy only that SHA. After the Vercel build: deployment state READY, commit SHA equals the recorded one, build used real Google Fonts (no substitution). This is the production-font build verification; until it is seen, it is PENDING.
2. Compare deployed source with the package (as done for f0382dc): lib/qab-rules.js, components/reports/QabTournamentReport.js, lib/help-answers.js byte-identical.

## 3. Live verification in Test Organization (never a real team)
Use a test game in Test Organization. Mark each as seen, with what you saw.
1. Record: choose RBI on a phone, Record QAB. Expect a QAB, tally up one QAB and one PA, row shows "RBI".
2. Reload: the at-bat is still RBI, the tally is the same.
3. Edit: RBI to Hit (QAB count unchanged), Hit to RBI, RBI to No QAB (QAB down one, PA same), No QAB to RBI.
4. Offline: airplane mode, record an RBI, reconnect. It syncs once, no duplicate, tally unchanged.
5. Reports (Season, Tournament, Player for that test scope; screen and print preview): RBI appears in the reason list; reason counts add up to the QAB total; QAB% = QAB / PA; RBI share = RBI QABs / total QABs; zero-RBI scopes show no RBI row; layouts, dates, pagination as in the approved previews.
6. Open-tab check: with a tracker tab opened BEFORE step 2 left untouched, confirm it keeps working, then reload it and confirm it now shows RBI correctly.
Cleanup: void the test at-bats afterwards (voided rows stay in the table, excluded from every total). No production data outside Test Organization is touched.

## Compatibility with a tracker tab opened before the release
Tested 2026-11-20 with the previous rules file against data holding RBI (scripts/verify-qab-rbi-old-tracker.js, 7 checks):
- Data is safe: the older tab never drops RBI. Saving a correction with nothing chosen sends 'rbi' back unchanged, still a QAB on the server. Choosing another reason or No QAB works. Its own offline entries sync once.
- Display is wrong for RBI: the older tab counts an RBI at-bat as not a QAB in its on-screen tally (1 of 4 where the server says 3 of 4), lists it as the raw word "rbi", and preselects no tile when editing. The saved status is unaffected.
- When it can happen: only if an older tab shows rows that already contain RBI. The tracker never refetches rows on its own and there is no service worker, so a stale tab sees RBI only after a reload, and a reload loads the new code. Exposure is a tab that was left open across the release and reads RBI some other way (for example, a conflict message after another device recorded RBI for the same slot).
- Smallest mitigation: no code. Release outside live games, ask coaches to reload the tracker after release. Unverified: whether Next.js server action calls from an already-open tab keep working across the deploy (they usually do; confirm in live check 6).

## Still PENDING after this runbook
Production-font build, migration applied and verified, deploy, every live check, real email delivery/sign-in tests, support mailbox test.
