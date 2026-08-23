# Migrations

95 files, one per migration applied to production, named for the version
Supabase recorded when it ran.

## Why this directory was rebuilt

The repository had drifted from production. Ninety-five migrations had been
applied through the Supabase MCP tool, but only six existed here as files — and
those six carried timestamps that did not match the versions they were applied
under. `supabase migration list` would have reported six pending migrations
whose objects already existed.

**Production was never wrong.** Every object in the database traced to a
recorded migration, and nothing existed that migrations did not explain. Only
the repository was incomplete.

## Provenance

Supabase stores the executed SQL for every migration in
`supabase_migrations.schema_migrations.statements`. All 95 rows carried a
complete payload — 213,218 characters in total — so the files here are the SQL
that actually ran, not a schema dump reconstructed from the result.

That is a stronger record than `pg_dump` would have produced: a dump describes
the end state, while these describe how it was reached, with the original
reasoning preserved in the comments.

Recovered on 2026-08-22 by exporting `schema_migrations` and writing one file
per row.

## The six comment-only differences

Six migrations already existed here in fuller form, written with explanatory
headers that the MCP tool stripped on the way in. Those files were **renamed to
their applied versions and their contents left alone**, so the extra
documentation survives:

| Version | Migration | Additional comments |
|---|---|---|
| 20260813211328 | feat_01_organization_features | +783 chars |
| 20260813211355 | qab_01_lineups_and_plate_appearances | +3,265 chars |
| 20260813211406 | qab_02_performance_views | +811 chars |
| 20260813224527 | qab_03_authoritative_pa_attribution | +2,780 chars |
| 20260814181219 | qab_04_pa_batting_order_snapshot | +2,459 chars |
| 20260814224504 | qab_05_game_qab_completion | +2,203 chars |

Each was verified equivalent after stripping SQL comments and collapsing
whitespace: identical statements, identical order. The difference is commentary
only. The Supabase CLI compares versions rather than content, so this does not
affect reconciliation.

The other 89 files are byte-identical to their recorded statements.

## Reconciliation performed

Before the rebuild, production was audited in both directions:

- **Replay to live** — every object created by the recorded SQL exists in
  production. Verified object-by-object for the QAB and feature migrations:
  20 of 20 present.
- **Live to replay** — all 31 tables, 30 application functions, 23 triggers and
  4 views are accounted for in the recorded history. **Zero unattributed
  objects**, so nothing was created outside a migration.

Live counts at the time of recovery: 31 tables (all with RLS enabled),
365 columns, 4 views, 30 application functions, 0 extension-owned functions in
`public`, 23 triggers, 69 RLS policies, 154 constraints, 97 indexes,
0 sequences.

Extensions: `plpgsql`, `pg_stat_statements`, `uuid-ossp`, `pgcrypto`,
`supabase_vault`. Supabase-managed schemas (`auth`, `storage`, `realtime`,
`graphql`, `vault`, `extensions`) are out of scope and are not represented here.

## Production migration history was NOT modified

No row in `supabase_migrations.schema_migrations` was inserted, updated or
deleted. No `migration repair` was run. No schema object, RLS policy, function,
trigger, constraint, index, view, grant or data row was changed.

The 95 history rows were already correct. The fix was entirely in this
repository.

## Notes

`roster` is a deprecated table, superseded by `players` + `team_season_players`
and not read by the application. It carries its own comment saying so. It
appears here as it exists in production.

## Verification

`node scripts/check-migrations.js` checks this directory offline — file naming,
duplicate versions, ordering and structure. It needs no network access and no
production credentials, and it runs as part of `npm run check`.

Reconciling these files against live production requires database access and is
therefore a separate, explicit audit rather than part of the standard check.
