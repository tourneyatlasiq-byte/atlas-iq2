# Pending migrations

SQL that has been designed and reviewed but **not yet applied to production**.

A file here is not a migration yet. It moves to `supabase/migrations/` only
after it has been applied through the MCP tool and named with the version
Supabase actually recorded — the process established in B0 that keeps the
repository and production history aligned.

**Nothing is currently pending.** This directory holds no SQL awaiting
application.

## Standing rule: Import Players stays disabled

**Import Players must remain disabled until C3 idempotency is implemented and
verified.**

The write path is applied and works, which is exactly what makes this easy to
get wrong — the only thing standing between a reviewed import and a duplicated
roster is the button staying switched off. Without persisted run identity
(`intake_runs`), a coach who retries an approved import writes it twice.

Applying a migration is not the same as shipping a feature.

## Previously applied from here

- `qab_one_reason` — one primary QAB reason per plate appearance:
  `pa_one_reason CHECK (cardinality(qab_reasons) <= 1)` on
  `plate_appearances`. Applied 2026-11-09 as `20261109220629_qab_one_reason`,
  after the application rule was deployed (630bbbb) and the single legacy
  two-reason row was reduced to its primary reason by a guarded update. The
  constraint validated against all 211 rows; zero multi-reason rows remain.
  The file is byte-identical to what ran, so its header still reads
  "PENDING. Not applied."

- `files_07_team_insurance_category` — the documents category "Insurance"
  became "Team Insurance" (the product renamed it in August; the constraint
  never followed, so every Team Insurance upload failed). Production bug fix,
  applied 2026-11-07 as `20261107131446_files_07_team_insurance_category`
  straight after review and a local test; it touched only the constraint.

- `fin_txn_status_to_pay_paid.sql` — transaction statuses `Planned | Ordered |
  Received | Paid` became `To Pay | Paid`, with the new constraint and a `Paid`
  default. Applied 2026-11-06 as `20261106224426_fin_txn_status_to_pay_paid`,
  after the matching application code was deployed and READY. Every guard
  passed: 3 rows moved to To Pay, 32 Paid untouched, no other column changed,
  and every Finance figure in all six seasons reconciled exactly to the
  pre-release baseline. The migration file is byte-identical to what ran, so
  its header still reads "PENDING. Not applied." — that line describes the
  file as it was reviewed, not its current state.

- `intake_apply.sql` — the atomic write path for Player Intake (C2). Applied
  as `20260823190858_intake_apply`. That migration file is now the single
  authoritative copy; its header carries the design rationale, so it is not
  repeated here.
