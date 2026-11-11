# Season Tempo — Performance: tournament selector + QAB guidance

Base: `main` @ `a7fc5c1` ("3b"). No database change. Independent of Showcase and of Phase 3.

## What it does
- Performance gains a compact **Tournament** selector (current season's committed tournaments,
  plus any with games). Labels: "T25 (Scenic) · 7 games need QABs", "… · QABs complete",
  "… · No games yet". Hidden when there is only one tournament.
- **Default tournament**, when none is chosen: (1) happening now — today within start..end,
  inclusive; (2) most recent past tournament with games needing QABs; (3) next upcoming with
  games; (4) next upcoming; (5) most recent. An upcoming tournament with no games no longer hides
  one waiting for QABs.
- Header label follows timing: Happening now / Next up / Played.
- The choice is kept in the URL (`/performance?tournament=…`); **Back to Performance** from QAB
  tracking returns to the same tournament.
- Contextual guidance: "How QAB tracking works — Choose a game and set the batting order to begin.
  Track plate appearances live during the game or enter them later." Shown when the tournament has
  games not yet started; open for a team with no QABs this season, one collapsed line otherwise.
- No games: "No games yet. Games are added in Tournaments…" + **Add games in Tournaments →**.
- Unchanged: game actions, season reporting, the season Games list, permissions, database.

## Files (11)
| File | Change |
|---|---|
| `lib/performance-tournament.js` | NEW — default rule, timing, compact labels (pure) |
| `components/PerformanceTournamentPicker.js` | NEW — the selector |
| `lib/queries/performance.js` | per-tournament game counts; URL choice; default |
| `app/(app)/performance/page.js` | selector, timing label, guidance, no-games copy |
| `components/TrackerClient.js` | Back to Performance keeps the tournament |
| `app/globals.css` | selector, guidance and link styles (appended) |
| `ATLAS-DECISIONS.md` | guidance decision; Help & Getting Started future milestone |
| `scripts/check-performance-tournament.js` | NEW — 39 regression assertions |
| `scripts/check-qab-tournament.js`, `scripts/check-qab-single-reason.js` | test harness: copy the new module |
| `package.json` | runs the new suite in `npm run check` |

## Deploy
1. Copy the ZIP contents over the repository root (paths are preserved).
2. GitHub Desktop: confirm exactly these 11 files changed; commit; push to `main`.
3. Wait for the Vercel production deployment to finish.

## Production acceptance (after deploy)
1. **Lynch (28/29 Lynch), Performance:** lands on **T25 (Scenic)** (not Clearwater); header "Played";
   selector reads "T25 (Scenic) · 7 games need QABs"; all 7 games show **Set batting order →**.
2. **Guidance:** Lynch has no QABs this season → "How QAB tracking works" is open with the two
   sentences. On Northgate (QABs recorded) it is one collapsed line.
3. **Selector:** choose Clearwater Invitational → URL gains `?tournament=…`; header "Next up";
   "No games yet…" with **Add games in Tournaments →**, which opens that tournament.
4. **Round trip:** from T25, Set batting order → set a lineup → track → Finish → **Back to
   Performance** returns to T25 (not the default). Skip writing if you prefer: opening a T25 game
   and using the browser Back button also returns to `?tournament=…`.
5. **Northgate (QAB-enabled, data recorded):** default and season reporting look as before;
   completed games still show **Review & Edit →**.
6. **Phone (≈390px):** selector full width, one line; no sideways scrolling.
7. **Runtime logs:** no new errors after the checks.
