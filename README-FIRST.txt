Season Tempo: compact timeline, Commit button, status text, player QAB report (2026-11-22)

This ZIP is the COMPLETE set of changed files since main 9d18f16. It includes the
earlier facility carry-over and drawer cleanup files, so you only need this ZIP.
Copy everything inside "files" into the repo folder, replacing files when asked.

What changed
1. Timeline (components/SeasonStrip.js, app/volt.css): compact by default, Expand/Compact
   button (remembered on that device), hover/tap details, click opens the tournament,
   dots that would touch merge into one numbered dot, range snapped to whole months,
   the "no start and end dates" note is gone.
2. Commit button: Commit and Register are always green; only the Paid action is white.
3. Considering rows and the timeline now also show registration (for example
   "Considering, Not in Budget, Waitlisted"). No data was changed.
4. Individual Player QAB report: the per-game dots are removed (the Game by game
   list already shows each game). Tournament bars stay. Data and calculations untouched.
   The Performance screen still shows the dots (not changed, your decision).
5. Checks: new scripts/check-season-strip.js, one assertion updated in
   scripts/check-qab-tournament-views-render.js, package.json "check" updated.

Known, not mine: components/reports/PrintTips.js still exists on main and fails one
check. The earlier cleanup ZIP deletes it; delete it in GitHub Desktop if not yet done.

Do not deploy until you have reviewed it on a preview.
