Season Tempo: new tournament shows up immediately after Save, and a lost reply no longer leaves a stale list or a duplicate
(for review, NOT deployed; this ZIP replaces the earlier tournament-add-refresh ZIP, use only this one)

Copy these files over the same paths in your project, review in GitHub Desktop, then commit:
  components/TournamentClient.js
  components/useOpenParam.js
  lib/overlay-history.js
  lib/actions/tournaments.js                (retry guard in addTournament, no database change)
  app/globals.css
  package.json                              (adds one check to npm run check)
  scripts/check-tournament-add-refresh.js   (NEW)
  scripts/check-mutation-reliability.js     (two assertions updated to the new code shape)
No database changes. No files to delete. No cache or global settings changed.

The one business rule in here: an identical add (same name and start date, same season) within
30 minutes of the first is treated as a retry and returns the tournament that already exists.
