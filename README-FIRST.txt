Season Tempo: tournament facility carry-over fix and drawer layout cleanup
Based on current main (9d18f16 "refresh"). Does not overwrite the tournament
save-to-list refresh fix; that code is already on main and is kept as is.

HOW TO USE
1. Open the "files" folder in this ZIP.
2. Copy its contents over your Season Tempo project folder, letting the
   folders merge and replacing the six files below.
3. In GitHub Desktop, review the six changed files, commit, push.
No database change. Nothing to delete.

FILES (6)
 app/volt.css                              drawer layout cleanup (CSS only)
 components/TournamentClient.js            facility carry-over fix, add-facility flow, wording
 components/QuickAddFacility.js            new-facility form starts with the search text
 lib/tournament-status.js                  "Not in Budget" wording
 package.json                              adds the new check to "npm run check"
 scripts/check-tournament-facility-flow.js new automated check (18 assertions)

SEPARATE, ALREADY KNOWN
"npm run check" has one failure that is not from this package: components/
reports/PrintTips.js still exists on main. Your earlier cleanup ZIP deletes it
(delete that file by hand in your project folder if you have not yet).
