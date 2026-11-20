# RBI as its own QAB reason (not deployed, migration not applied)

Release in this order:
1. Apply supabase/migrations/20261120213000_qab_rbi_reason.sql, then verify it (docs/qab-rbi-release-runbook.md, section 1).
2. Upload and deploy the application files in this package.
3. In Test Organization verify RBI recording, editing, offline sync and the Season, Tournament and Player reports (runbook section 3).
4. Reload any open tracker after release (ask coaches to reload it).

Reversing steps 1 and 2 makes RBI taps fail (the database refuses the new key) and queued RBI entries land in Needs review.
If an earlier RBI zip was unpacked, delete supabase/pending/qab_rbi_reason.sql.

App change (one list drives everything):
- lib/qab-rules.js: `{ key: "rbi", label: "RBI" }` appended last (existing tap positions and keys unchanged). Tracker tiles, correction panel, validation, offline queue, recovery, derivation, Season/Tournament/Player reports and the tournament_reason view all read this one list.
- components/reports/QabTournamentReport.js: reason-mix ink ramp 8 -> 9 steps so no colour repeats.
- lib/help-answers.js: help text lists nine reasons.
- Tests: check-qab-rbi.js (new, in npm run check), test-rbi-local.sh/.js (local Postgres), verify-qab-rbi-browser.js and verify-qab-rbi-old-tracker.js (Chrome; setup in scripts/browser-harness/README.md). local-rest-shim.js gained upsert-ignore and not.is.null support (test tooling only).

Database change (only one): widen CHECK pa_reasons_allowed to include 'rbi'. pa_one_reason, generated is_qab, trigger and views are untouched.
No data is changed. Historical Hit and Situational success rows are never relabelled.
