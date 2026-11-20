# Tracker: restore the device queue on return (finding 1)

## The problem
The tracker page is rendered on the server from the database. At-bats that were recorded offline and were still in this phone's
queue are not in that snapshot. On return (Back to Tracking, or a reload) the tracker sent the queue, found it empty, and showed
"All saved" over a list that did not yet contain those at-bats: wrong batter, old totals.

## The fix
- `lib/tracker-restore.js` (new, pure, unit tested): `restoreFromQueue` rebuilds the list from the server snapshot plus this
  account's queued record, correct and void entries, with no duplicates (same id, or same slot, is never added twice), and
  computes the batter after the last queued appearance. Entries in review (or behind one) and other accounts' entries are not applied.
  `hideConflictedPending` and `settleGroup` keep the screen right while a conflict is open and after Keep saved, Use unsynced or Discard.
- `components/TrackerClient.js`: on mount the queue is read once before anything else. Until it is read the screen shows
  "Getting this game ready..." and no batter, totals or recording buttons. If the queue cannot be read, it says "Recording is paused",
  explains why, offers Retry, and recording stays off (`canWrite` is false), so nothing is recorded against an unreliable batter.
  Sending starts only after the restore is ready. A pass that is skipped because another is in flight is retried (up to 6 times).
- `lib/sync-status.js`: `syncDisplay` takes `restore` ("loading" | "failed" | "ready"); "All saved" needs a finished restore,
  a readable empty queue, online and nothing sending.
- Back to live (from Edit at-bats) now lands with Now batting pinned under the header and the reason choices in view on a phone.

## Phone layout (small, separate rules in `app/volt.css`, phone media query only)
Tighter card and gap spacing. Reason tiles stay 56px or taller, labels stay 15px, Record QAB and No QAB stay 56px.
Measured (emulated): the swipe needed on arrival went from 297px to 242px at 375x812 and 265px to 210px at 390x844.
Once the Now batting card is pinned, no further scroll is needed per at-bat. Broader layout changes (for example a sticky
status line) are not part of this package.

## Tests
- `npm run check` (now includes `check-tracker-restore.js`, 28 assertions; `check-sync-status.js` has restore cases).
- Browser harness: `scripts/verify-tracker-queue-restore.js` (46 checks, including a viewer whose storage cannot be read and a check that an open conflict does not make the screen re-read the queue in a loop), plus the existing RBI and review navigation scripts.
- Three static checks were updated for intended behavior changes: check-volt-perf-tracker (Retry wiring), check-tracker-review-nav (Back to live target).
- Not covered: a physical phone, real airplane mode, a real on-screen keyboard, and `next build` (not runnable in the sandbox).

## Independent review
A separate reviewer read the diff and found a refresh loop while a conflict waits for review (fixed: the review list keeps its identity
until something about it changes; the browser check reads the queue 8,112 times in 2.5 seconds without the fix and 0 to 5 with it),
and read-only viewers being blocked when storage cannot be read (fixed: they skip the restore). The skipped-pass retry timer is now cleared on unmount.

## Known limits
- If a send started by the screen you just left finishes in the instant between the server rendering this page and this screen reading the
  queue, those at-bats are in neither and the list can lag until the next reload. Record actions already refresh the page data, which
  makes this unlikely. Closing it fully needs a fresh server read on return; not done here.
- Discard or Keep saved of a rejected correction restores the value from the page-open snapshot, so an earlier successful edit
  in the same session could look reverted until the next reload (the database is unaffected).
- The status line scrolls out of view while recording on a phone.
