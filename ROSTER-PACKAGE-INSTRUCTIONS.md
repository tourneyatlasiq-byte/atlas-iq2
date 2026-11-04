# Roster package: uniform sizes + phone Edit details

Built on production `main` @ 44629a9. No database change.

Copy the contents of this folder into the root of your atlas-iq2 clone, replacing
files when asked. GitHub Desktop should show exactly 6 changed files:

- components/RosterClient.js      (shared size list; unlisted stored sizes kept; Edit details in drawer header on phones)
- app/globals.css                 (shows header Edit details at 720px and below, hides the footer one)
- lib/intake/registry.js          (UNIFORM_SIZES: YXS YS YM YL YXL AXS AS AM AL AXL AXXL)
- lib/queries/roster.js           (re-exports the shared list)
- scripts/check-uniform-sizes.js  (new, 17 assertions)
- package.json                    (adds the new check to `npm run check`)

Ignore this instructions file; do not commit it.

Acceptance on iPhone Safari after deploy:
1. Team > tap a player: "Edit details" is at the top right, next to the X.
2. Tap it: the edit form opens. Jersey and Pants size list all 11 sizes.
3. A player whose size was imported as S/M/L/XS still shows that size in Edit.
4. On a laptop, Edit details is still at the bottom right of the drawer, as before.
