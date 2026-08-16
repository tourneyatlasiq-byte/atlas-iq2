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

---

## 6. Future concept: Funding Plan (NOT implemented)

Recorded for later consideration. **Nothing in the product calculates this
today, and the parent Season Budget report deliberately does not imply it.**

### What the data model establishes now

Season budget, player dues and expected fundraising are **three independent
facts** with no relationship between them anywhere in code or schema:

- Dues are typed in by the coach (`setDuesForAll` reads `initial_cost` from
  form input). Nothing derives them from the budget.
- Income budget lines are never netted against expenses. `financeSummary`
  sums `budgetedExpenses` and `budgetedIncome` separately, and every derived
  figure — `availableBudget`, `remainingBudget`, `percentCommitted` — uses
  expenses only. Money In states it plainly: "Kept separate from expenses —
  never netted against the budget."

Northgate illustrates why an inferred relationship would be wrong:

```
Planned expenses                   $29,480
Dues (12 × $2,400)                 $28,800
Fundraising & sponsorship targets  $ 3,000
                                   -------
Planned funding                    $31,800   → $2,320 above expenses
```

If fundraising offset dues, dues would have been set near $2,207. They were
not. Whether the $2,320 is a buffer, rounding to a clean $2,400, or two
figures set independently, **the data does not say** — so no report may
assert it.

### What a Funding Plan would need

A deliberate model, not a derived number:

1. An explicit statement of how the season is intended to be funded — dues,
   fundraising, sponsorship, carry-over — with the coach's intent recorded
   rather than inferred from whatever the numbers happen to be.
2. A defined treatment of surplus and shortfall, including what a surplus is
   FOR (buffer, next season, refund) — a question the current schema cannot
   answer.
3. A decision on whether fundraising is attributed per family or to the team
   as a whole. Nothing expresses per-family attribution today, which is why
   "cost after fundraising" cannot be computed.
4. Parent-facing wording that survives a parent doing the arithmetic.

### Wording that must NOT be used until such a model exists

"Fundraising reduces dues", "offsets dues", "covers the budget gap", "planned
in addition to dues", "cost after fundraising", or any surplus/shortfall
figure. Each asserts a relationship the model does not establish.

---

## 7. Stabilization status (Batch 1 closed)

### Schema baseline — BLOCKED on an action only you can take

Production has 95 applied migrations; the repository holds 6 files. Worse, the
6 files' versions are NOT the versions recorded in production: the same
migrations were applied through MCP `apply_migration`, which assigns its own
timestamp.

| Migration | Repo filename | Applied as |
|---|---|---|
| `feat_01_organization_features` | `20260813120000` | `20260813211328` |
| `qab_05_game_qab_completion`    | `20260814210000` | `20260814224504` |

Consequence: **`supabase db push` would attempt to re-apply all six** against a
database that already has them.

An authoritative dump CANNOT be produced from the assistant environment. No
Supabase CLI, no `pg_dump`/`psql`, `db.<ref>.supabase.co` does not resolve, and
`api.supabase.com` / the pooler are blocked by egress policy. A hand-assembled
baseline from `pg_catalog` was considered and REJECTED as insufficiently
trustworthy.

**Required, run locally:**

```bash
supabase link --project-ref iiyuagxdeafkxrtixktr
supabase db dump --schema public -f supabase/migrations/00000000000000_baseline.sql
```

Read-only. Version `00000000000000` sorts before the earliest applied
migration (`20260805233358`), so it can never interleave.

**Then, in order:**

1. `supabase migration list` — compare local against remote.
2. `supabase migration repair --status applied 00000000000000` — records the
   baseline as applied. Inserts one history row; runs no DDL.
3. `supabase db push --dry-run` — MUST print "Remote database is up to date."
   Anything else means something would be re-applied. Stop if so.
4. Only then move the 6 orphan files to `supabase/migrations/_archive/`.
   DECISION: archive, never delete. The CLI ignores subdirectories.

**No new migration may be created until this is resolved.** That includes the
foreign-key indexes identified in the audit.

### Tournament finance — decided and implemented

Coaches MAY commit to a tournament without a budget category. Forcing the
choice at commit time would push coaches to skip recording the commitment,
which is worse data.

- `availableBudget` keeps its meaning: budget not yet committed TO A CATEGORY.
  Not redefined, not recalculated.
- When unassigned commitments exist, Finance additionally shows the unassigned
  total and **Projected Available = Available − unassigned**. Hidden entirely
  when there are none.
- At transaction entry, choosing a tournament that has no budget category
  offers an explicit, confirmable checkbox to assign it to the same budget
  line the transaction already requires. Never silent, never retroactive,
  routed through `setTournamentBudgetLine` so
  `enforce_tournament_budget_link` still validates org, season and
  expense-not-income.
- The transaction saves first; a failed assignment never blocks recording the
  money.

Reference figures at time of writing: Northgate $20,276 available, $1,315
unassigned, $18,961 projected. Georgia Power $32,648 / $9,255 / $23,393.

### Georgia Power legacy dues — accepted as legacy data debt

Six `player_payments` rows with `player_id = NULL`, ids
`10000000-…-0001` through `-0006`, $2,700 each, 22 payment log entries, all
dated 2026-08-05, seeded by `20260810103842 fin_05_backfill_georgia_power_season`.
The legacy `player_name` column holds surnames; four of six resolve to exactly
one player (Cox, Mower, Bohannon, Terry), two do not (Thaxton, Lower).

Classified: **historical legacy condition, no longer creatable.**
`savePlayerPayment` rejects an empty `player_id` and requires season-roster
membership; `setDuesForAll` iterates roster players only.

UNTOUCHED by decision. A `player_id NOT NULL` constraint is deliberately
DEFERRED until the schema baseline is stable — it would mean another untracked
schema change on top of an unreproducible history.

### Money arithmetic — closed

All currency aggregation uses integer cents (`sumMoney`/`toCents`). Zero float
money reduces remain in `lib/queries/finance.js`. Merged as `6917eb5`.

### Batch 2 backlog, in dependency order

1. **Schema baseline + migration repair** — blocks everything requiring DDL.
2. **Foreign-key indexes** — 16 FK columns unindexed, including
   `organization_id` on `plate_appearances`, `game_lineup_slots`, `games`,
   `player_payments`. Every RLS policy filters on it. NEEDS A MIGRATION, so
   blocked on (1).
3. **E2E suite (5 tests)** — no migration needed, can start now. Load Finance
   and assert totals; copy a lineup; track a PA then reload and assert the next
   batter; open the report and assert no player name in the DOM; log in as
   org B and assert org A's game 404s.
4. **`fundsIn` category matching** — hardcodes "Fundraising"/"Sponsors" while
   `budget_items.category` is free text. Georgia Power's
   "Fundraising & Sponsors" falls into the residual `other`.
5. **Documentation** — `ATLAS-DECISIONS.md`, `ATLAS-PRODUCT-RULES.md`,
   `BUSINESS-RULES.md` and `README.md` still say "Player Payments".
6. **Dead CSS** — `.fin-lead-main`, `.fin-secondary`, `.fin-metric`,
   `.fi-list`, `.fi-row-total`; orphaned `copy_previous_lineup()` RPC.
7. **`facility_code_sequences`** — RLS on, zero policies. Fails closed;
   confirm no runtime path depends on it.
8. **Unrelated but open:** rotate the Geocodio key and delete
   `temp/geocodio-dryrun`; decide on the public GitHub repo.
