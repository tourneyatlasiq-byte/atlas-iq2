# QAB plate appearance notes

Built on `main` at `9c5bd36` ("showcase"). Separate from Help & Getting Started V1 and from auth 3C;
it shares no files with the Help package except `app/globals.css` and `package.json`, where both
only append (see "If Help ships first").

## What it does

An optional free-form note on one plate appearance, using the existing `plate_appearances.notes`
column. "+ Add note" while recording and in Review & Edit; saved notes show as a small grey line.
Trimmed, blank stored as null, 280 characters maximum. A duplicate submission from a second phone
whose note differs is a conflict for the coach, never silently dropped. Notes never affect QAB,
QAB%, QAB status, W-L-T, game results, reports or any calculation, and appear only where Performance
data is shown (the tracker). Not in any report or parent-facing output.

## Apply (code)

1. Copy the ZIP's contents into the root of your `atlas-iq2` clone, allowing overwrite.
2. GitHub Desktop should show exactly **12 changed files**: 8 modified, 4 new.

Modified: `app/globals.css`, `components/TrackerClient.js`, `lib/actions/plate-appearances.js`,
`lib/qab-rules.js`, `lib/queue-recovery.js`, `package.json`, `scripts/check-qab-single-reason.js`,
`scripts/check-queue-recovery.js`.

New: `scripts/check-qab-notes.js`,
`supabase/migrations/20261112115235_qab_06_pa_notes_length.sql`, `QAB-PA-NOTES-INSTRUCTIONS.md`,
`0001-QAB-plate-appearance-notes.patch` (optional, for reference).

If the count differs, stop and tell Claude before committing.

## Apply (database), only with explicit approval

The migration adds one check constraint and changes no rows (production had 0 notes on
2026-11-12). Code and constraint are safe in either order: the application already refuses notes
over 280 characters. Claude applies it via the Supabase migration tool once Autumn approves, then
re-verifies migration parity (repo and production must both list `20261112115235`).

## If Help ships first

Both packages append a block to the end of `app/globals.css` and add one script to the
`npm run check` line in `package.json`. Claude will rebase this package onto the deployed Help
commit and re-package rather than have those two files copied over each other.

## Check in production after deploy (a QAB-enabled organization)

1. Track a plate appearance: "+ Add note" opens a field with a counter; record with a note.
2. Edit at-bats: the note shows under that plate appearance; Edit shows it filled in; change it and save.
3. Change only the reason on a plate appearance that has a note: the note is unchanged.
4. QAB% and the QAB report are unchanged by adding or editing notes; the report shows no notes.
5. A 281-character note can't be recorded.
