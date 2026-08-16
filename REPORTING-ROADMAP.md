# Reporting Roadmap

Findings from the reporting-readiness audit and the infrastructure work done
against it. **No Reports feature, PDF generation, print layout or Reports
navigation exists yet, and none is planned in the current pass.** This file
exists so the analysis is not re-derived later.

---

## 1. Planned report catalogue

Audience and scope differ per report; several are parent-facing and must not
expose internal administrative views.

**Finance**
- Parent-facing Season Budget
- Internal Team Financial Report
- Player Dues Report
- Individual Player Statement

**Tournaments / Schedule**
- Season Schedule
- Tournament Schedule / Weekend Sheet
- Tournament Summary

**Performance / QAB**
- Game Performance Report
- Tournament Performance Report
- Individual Player Performance Report
- Season Performance Report

**Team**
- Team Roster
- Team / Season Summary

**Cross-module**
- Full Season Report combining schedule, tournament, financial, roster and
  performance information.

Intended scopes: organization, team, season, date range, tournament, game,
player. Intended UX: a central Reports area plus contextual entry points
(Finance launches a Budget Report, a tournament launches its Tournament
Report, a player launches a Player Performance Report).

---

## 2. Architectural rules to hold to

1. Queries accept **explicit scope IDs**. RLS is authorization — what a caller
   MAY read — not view or report selection, which is what they ASKED for.
   Conflating the two is what allowed Performance to aggregate across seasons.
2. Reusable business calculations live in pure derivation/rules modules
   (`lib/finance-rules.js`, `lib/qab-rules.js`, `lib/queries/*` pure exports),
   never in React components. A PDF renderer cannot run a component.
3. React components render already-derived data.
4. Request/cookie context (`getContext()`) stays at the interactive page
   boundary. A report may need a season the user is not currently viewing, or
   no request at all.
5. Reports get dedicated print templates. Never screenshot or print
   application pages.

---

## 3. What is already in place

- **Pure derivation layer**: `buildBudget`, `financeSummary`, `duesSummary`,
  `fundsIn`, `tournamentPaidTotal`, `duesCollectedPercent`, `outstandingTotal`,
  `seasonRecord`, `deriveSummary`, `summarizeGame`, `tallyPlateAppearances`,
  `playerGameHistory`, `recentForm`, `budgetLineFinance`. All take data and
  return data — a report can call every one unchanged.
- **Audience scoping already enforced in the database.** 13 of 69 RLS policies
  carry parent-specific rules across `budget_items`, `budget_transactions`,
  `payment_log`, `player_payments`, `plate_appearances`, `players`,
  `documents`, `contacts`, `team_season_players`, `tournament_participants`
  and others: a parent sees only rows for their linked players. This is the
  hardest part of parent-facing reports and it is already below the
  application, not in the UI.
- **Money arithmetic centralised** in integer cents (`sumMoney`, `cents`,
  `toCents`), so reports inherit correct rounding.
- **Performance queries are season-scoped** and accept optional `gameId` /
  `playerId`.

---

## 4. Known gaps — deliberately not built

- **`tournamentId` and date-range scopes on Performance.** Neither is a direct
  column on `plate_appearances`; both need an embedded filter or a games
  pre-query. A design decision, not a two-line addition.
- **`getPerformanceOverview` picks "the" tournament by date.** Correct for a
  page, wrong for a report targeting a specific tournament.
- **Other modules take a single scope ID** (`listBudgetItems(seasonId)`,
  `listFacilities(organizationId)`). Correct today; a Full Season Report
  spanning seasons will want date ranges.
- **No `created_at` on `games`.** Ordering relies on `game_date`, `start_time`
  and `id`.
- **`start_time` is null on most games.** Ordering is deterministic but a date
  whose games are all untimed falls back to `id`, which is stable rather than
  genuinely chronological. This is a data-entry improvement, not a code one.
- **No print stylesheet or print layout primitives.** Nothing blocks adding
  them; nothing exists yet.

---

## 5. Ordering decision: `start_time` NULLS LAST

Games on the same date sort by `game_date`, then `start_time` **nulls last**,
then `id`.

A game with a recorded time can be placed in the day's sequence. A game
without one cannot. Sorting the unknown first would assert it happened before
the 9:20 game — a claim the data does not support. Appending it says only
"this game has no recorded time", which is true. NULLS LAST is also Postgres's
default for ASC, so the application matches the database rather than
overriding it.

`id` is a final tiebreak so repeated requests agree. It is a random UUID and
must never be presented as chronology.

Note `lib/queries/tournaments.js` still uses `nullsFirst: true` for the
tournament drawer's game list (pre-existing). Worth aligning when that view is
next touched; not changed here to keep this pass scoped.
