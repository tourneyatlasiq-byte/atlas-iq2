# Uniform sizes package

Built on production `main` @ 44629a9. No database change.

Copy the contents of this folder into the root of your atlas-iq2 clone, replacing
files when asked. GitHub Desktop should show exactly 5 changed files:

- components/RosterClient.js   (size selects use the shared list; unlisted stored sizes are kept)
- lib/intake/registry.js       (UNIFORM_SIZES: YXS YS YM YL YXL AXS AS AM AL AXL AXXL)
- lib/queries/roster.js        (re-exports the shared list instead of its own copy)
- scripts/check-uniform-sizes.js (new, 12 assertions)
- package.json                 (adds the new check to `npm run check`)

Ignore this instructions file; do not commit it.

After deploy, check: Team > open a player > Edit details > Jersey size and Pants size
show all 11 sizes; a player whose size was imported as "M" or "S" still shows that value.
