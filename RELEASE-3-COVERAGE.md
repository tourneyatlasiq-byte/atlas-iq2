# Release 3 package: coverage

Base: origin/main 56e01ad. 12 commits on branch release3, none deployed, no production data touched.
Files under repo/ use repo-relative paths: copy over the project root.

## Form coverage (real pages, phone 390 and desktop 1280, each run on both)

Method: the real components in a scratch app with server actions that count writes, delay and fail on demand.
Rule tested: one save at a time per form. A second submit waits until the pending one finishes, even if values changed.
Independent forms use their own runner and stay usable.

| Form | Rapid second tap and changed-value submit while pending: one write | Error inside the open form, draft kept | Saving and success feedback | Pressed feedback | Lost response then retry |
|---|---|---|---|---|---|
| Lineup save | pass | pass (message above the list and in the save bar, order kept) | Saving..., "Saved the batting order." | add, move, remove, Save: pass | pass |
| Event roster sheet | pass | pass (inside sheet, selections kept) | Saving..., toast "Saved the roster for <tournament>." | rows, buttons: pass | pass |
| Add pickup (existing and new) | pass | pass (inside sheet, entries kept) | Adding..., toast "Added a pickup player to <tournament>." | results, buttons: pass | pass |
| Record payment | pass (synchronous lock plus disabled button) | pass (inside sheet, amount and date kept) | Saving, toast "Recorded $X from <player>. $Y left." with Undo | buttons: pass | pass, same request key reused on every retry |
| Tournament edit | pass | pass (inside form, edits kept) | Saving..., toast "Saved changes to <tournament>." | buttons: pass | pass |
| Player and game forms (extra) | pass by shared runner / own lock | pass | toast names the change | buttons: pass | n/a |

Payments: server-side protection is unchanged (request_key makes a retry return the first entry; expected_paid refuses a stale balance). The client now reuses one key for every attempt from an open sheet, which the test confirms.

Results: 128 real-page assertions, 0 failed. Source guards: 32 new assertions in scripts/check-submit-feedback.js. Full chain `npm run check`: exit 0. Scratch production build: compiled.

## What changed in this step
- Shared runners (useMutation, useActionFeedback): per-form lock; thrown responses become a message instead of hanging.
- Event roster: pickup sheet errors were shown behind the sheet; now inside it. Roster and pickup saves confirm what changed.
- Payment sheet: synchronous in-flight lock closes the same-instant double tap.
- Pressed feedback: .btn already pressed; non-.btn controls (lineup add/move/remove/Save, roster rows, pickup results, remove, Add someone) did not. Added to app/volt.css, off for disabled controls and reduced motion.
- Error notices (.notice-error) rendered green on every screen. Now red. This also corrects the same notice on the tracker and final-score follow-up.

## Not changed
Contacts, Files, attendance shortcut, dismissal database column, HOME-001, and all previously deferred work.
