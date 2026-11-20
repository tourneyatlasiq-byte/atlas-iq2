# Tracker: opening a player's at-bats, and the way back

Not deployed. For review.

## What was wrong (reproduced on the deployed code, phone width, 9 players, 3 at-bats each)
- Tapping a row in "This game" (live view) switched to Edit at-bats and scrolled to the top of the whole list, not to the player tapped. The 4th player's section ended up 1,077px down, off screen.
- The tab strip scrolled out of reach under the page header, so the only control on screen was Finish tracking.
- Not a bug: the tab did switch to Edit at-bats on purpose, and nothing was expanded. The row's identity was simply thrown away.

## What changed (view only)
- A row in "This game" now opens Edit at-bats at that player's section, below the header, with their at-bats on screen. Nothing is expanded, and focus moves to the player's section for screen readers.
- Edit at-bats has a "Back to live tracking" button pinned directly under the page header, so it stays on screen while the list scrolls. The tracker measures the header's real height (it is 62px on a phone but can grow if it wraps) instead of assuming a number. It returns to Live Tracking from the top, where Now batting is.
- Finish tracking is unchanged and still separate.
- The Edit at-bats tab, completed-game "Edit at-bats" button, Live Tracking tab: unchanged.

## Not changed
QAB calculations, RBI, batting order, save and sync rules, the offline queue, the database. The change reads no row data and writes nothing.

## Files
components/TrackerClient.js, app/globals.css, package.json (adds one check to `npm run check`), scripts/check-tracker-review-nav.js (new), scripts/verify-tracker-review-nav.js (new, browser), and for the browser script only: scripts/browser-harness/build.js, stub-actions.js, entry-shell.jsx (new). No product file other than the first two.

## Verified
- `npm run check` passes (after the stylesheet change it must be run from a committed tree: check-qab-trend compares globals.css to HEAD).
- Real Chrome with the app's real header (sticky) and bottom bar (fixed), 22 of 22 at 390x844, 360x740, 320x568, 430x932 and 390x667: the 4th player lands below the header and the Back bar; Back stays visible and is what a finger reaches at every scroll position; it follows a taller header; an offline RBI survives and syncs once. Desktop and tablet widths also checked by hand-run script.
- scripts/verify-qab-rbi-browser.js still 21 of 21.

## Not verified
The production fonts (Inter Tight, Schibsted Grotesk were not available here, so the header is measured with a system font; the code reads the live height so it follows), a real phone, keyboard and screen reader behaviour by hand, a live Test Organization pass after deploy.
