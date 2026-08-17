# Season Tempo — Open Audit Findings

Confirmed defects and product gaps found during audit, **not yet fixed**, each
with the evidence that established it. An entry leaves this file only when the
work is done or the finding is explicitly retired with a reason.

Raised: 17 Aug 2026, during the QAB Performance report review.
Neither finding is caused by that report, and neither was changed by it.

---

## A. Games that should not count toward season performance

**Status:** open. Design investigation only — no implementation authorised.
**Type:** product gap with data-integrity consequences.
**Severity:** high. It corrupts the headline number of a paid feature, for
customers, permanently, with no remedy inside the product.

### The finding

Coaches evaluate the QAB tracker by tracking a fake game against a placeholder
opponent, in production, on their real roster. Those plate appearances are
indistinguishable from real ones and permanently join season performance.
There is no concept of a game that does not count, no exclusion, and no
warning. The only remedy today is deleting rows from the database.

### Evidence (production, 17 Aug 2026)

| Org | Games | Opponent names | Live PA | Recorded by | Effect |
|---|---|---|---|---|---|
| Northgate Fastpitch | 1 | `Test` | 1 | `amower7997` | Season QAB% 57.7% → **58.2%**; games 5 → 6 |
| Armor Elite | 4 | `Test`, `Test2`, `Test3`, `Test4` | 94 | `cmower78` | **100% of the org's tracked data** |

Corroborating detail:

- Both sets attach to tournaments months away from the game date — Northgate's
  `Test` is dated 4 Aug inside *Rome Fall Invitational* (7–8 Nov); Armor
  Elite's four are dated 16 Aug inside *TC Veterans Tribute* (6–8 Nov).
- Armor Elite's four are all marked tracking-complete, so completion state
  cannot be used to identify them.
- Northgate's appears **first** in QAB% by Game: the first row a coach reads is
  100% on one at-bat against an opponent called Test.
- Armor Elite is a live trial organization. When their real season begins,
  every season figure they see will be diluted by four evaluation games.

### Questions the design must answer

1. **Terminology.** "Exhibition", "scrimmage", "practice", "does not count",
   "excluded"? The word appears on the game, in Performance, and in reports,
   so it has to survive all three. It must not read as an accusation of bad
   data when the coach did nothing wrong.
2. **Where it belongs.** A column on `games`? A `game_type` value (one already
   exists: Pool / Bracket / …)? Or is the real concept a *tournament* that does
   not count, since both real cases are one throwaway tournament? Reusing
   `game_type` is cheapest but conflates competition format with counting
   rules — two different questions that will diverge.
3. **Effect on Performance.** Excluded from the season aggregate, clearly —
   but does the game still appear in the games list, greyed, or vanish? A game
   that silently disappears after tracking is a support ticket.
4. **Effect on QAB reporting.** The report reconciles to `getSeasonPerformance`
   by design and must continue to. Exclusion belongs in the derivation, once,
   not in each report.
5. **Historical attribution.** Tracking history is preserved, never deleted —
   the plate appearances remain attributed to the players who earned them and
   the coach who recorded them. Excluding is a display and aggregation rule,
   not a data deletion.
6. **Who may set it, and when.** After tracking is complete? Retroactively?
   Does flipping it silently restate a figure a coach already reported to
   parents? A change of this kind probably needs to be visible.
7. **Default.** Almost certainly "counts", with exclusion an explicit coach
   action — consistent with the established rule that coach actions are never
   inferred.

### Deliberately not proposed here

No schema, no column name, no migration. The point of this entry is that the
gap is recorded, not that the answer is settled.

---

## B. Season record is read without a season filter

**Status:** open, confirmed. Investigation complete; fix not applied.
**Type:** correctness defect.
**Severity:** medium. Latent today, wrong the moment any customer has a second
season or a second team.

### The finding

In `lib/queries/performance.js`, `getSeasonPerformance(seasonId)` scopes its
plate-appearance query explicitly, but the separate read that produces the
W/L/T record does not:

```js
const { data: resultRows } = await supabase.from("games").select("result");
```

No `.eq("season_id", seasonId)`. It relies entirely on RLS, which answers a
different question: RLS says what the caller *may* read, not what was *asked
for*. This is the same defect already fixed for plate appearances in the same
function; this read was missed.

### Evidence

RLS on `games` (production):

```
games: season read   SELECT   season_id IN (SELECT auth_season_ids())
```

```sql
auth_season_ids() -> select s.id from seasons s where s.team_id in (select auth_team_ids());

auth_team_ids()   -> every team in the caller's organization
                     when profiles.role in ('owner','admin'),
                     otherwise the teams they hold a team_membership for.
```

So for an owner or admin the unfiltered read returns games from **every season
of every team in the organization**. For a team-scoped coach it still returns
**every season of that team**.

Confirmed empirically in a `begin … rollback` transaction: a second Northgate
season carrying a 0–3 record was injected, both reads run, and the transaction
rolled back (verified afterwards — 0 injected rows remain, Northgate still has
1 season and 6 games).

| Read | W | L | T | Played | Total | Win% |
|---|---|---|---|---|---|---|
| Unfiltered (current code) | 3 | 4 | 0 | 7 | 9 | **43%** |
| Season-scoped (correct) | 3 | 1 | 0 | 4 | 6 | **75%** |

A 75% season would be displayed to the coach as 43%.

**Why it is invisible right now:** every organization in production has exactly
one team and exactly one season (Armor Elite, Braves, Georgia Power 2028,
Northgate Fastpitch, Test Organization). The two reads return identical rows.
The first customer to roll into a second season, or add a second team, sees a
wrong record with no error and no clue.

### Consumers

`record` is rendered by `components/PerformanceSeason.js` (W–L–T, win %, "N of
M games with a result recorded") and `components/GamesSection.js`. It is **not**
in the QAB Performance report payload, so no report is affected today.

### Smallest safe fix

One line, matching the scoping already applied to the plate-appearance query
directly above it:

```js
const { data: resultRows } = await supabase
  .from("games")
  .select("result")
  .eq("season_id", seasonId);
```

- No schema change, no migration, no RLS change. RLS remains the security
  boundary and is untouched; this is application scope.
- No behaviour change in production today, because the two reads currently
  return the same rows — which also means it can be shipped and verified
  without waiting for a customer to hit the bug.
- `record.total` changes meaning from "all games I can see" to "all games this
  season", which is what the label already claims.
- Wants a regression case pinning that a second season's results do not appear
  in the first season's record.

Not applied. Awaiting authorisation.
