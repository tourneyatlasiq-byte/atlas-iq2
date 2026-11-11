# Season Tempo — Game type: Showcase (app release)

Base: `main` @ `3ad444f` ("QAB"). The database migration is ALREADY LIVE in production
(`20261111153048 games_04_showcase_game_type`, md5 `c6aa86b6b6cfa0d36f3b60d06f282fd5`).
This release only exposes Showcase in the app and records the migration file in the repo.

## Files (5)
| File | Change |
|---|---|
| `lib/game-rules.js` | GAME_TYPES: Pool, Bracket, Championship, **Showcase**, Friendly, Scrimmage |
| `supabase/migrations/20261111153048_games_04_showcase_game_type.sql` | migration record (already applied; committing it does not re-run it) |
| `scripts/check-game-types.js` | NEW — 19 assertions (list = database rule, form, real save action, displays) |
| `scripts/check-schedule-report.js` | Showcase printed in the Tournament Schedule PDF |
| `package.json` | runs the new suite in `npm run check` |

## Deploy
1. Copy the ZIP contents over the repository root.
2. GitHub Desktop: confirm exactly these 5 files changed; commit; push to `main`.
3. Wait for the Vercel production deployment.

## Production acceptance (after deploy)
1. Tournaments → any current-season tournament → add or edit a game: the Type list reads
   Pool, Bracket, Championship, **Showcase**, Friendly, Scrimmage.
2. Save a game as Showcase (a real game you intend to keep, or edit one and change it back):
   it saves; the game row shows "· Showcase".
3. Tournament Schedule PDF (Include game schedule) shows "· Showcase" beside that game.
4. Existing games keep their types; W-L-T unchanged.
5. Runtime logs: no new errors.
