# Pending migrations

SQL that has been designed and reviewed but **not yet applied to production**.

A file here is not a migration yet. It moves to `supabase/migrations/` only
after it has been applied through the MCP tool and named with the version
Supabase actually recorded — the process established in B0 that keeps the
repository and production history aligned.

**One migration is pending.**

- `fin_txn_status_to_pay_paid.sql` — transaction statuses `Planned | Ordered |
  Received | Paid` become `To Pay | Paid` (Ordered and Received → To Pay;
  Planned → To Pay only when it has no amount; Paid untouched), with the
  constraint and a `Paid` default. Guarded: it aborts and rolls back if a
  Planned row has an amount, an income row isn't Paid, any non-status column
  changes, or the money attributed to Paid or To Pay changes for any season,
  budget line or tournament. Reviewed and tested against a local copy of the
  production table. It is applied only after the matching application code is
  deployed and READY — the release is code first, then this migration
  immediately. Once applied, it moves to `supabase/migrations/` under the
  version Supabase records, and this entry moves to the list below.

## Standing rule: Import Players stays disabled

**Import Players must remain disabled until C3 idempotency is implemented and
verified.**

The write path is applied and works, which is exactly what makes this easy to
get wrong — the only thing standing between a reviewed import and a duplicated
roster is the button staying switched off. Without persisted run identity
(`intake_runs`), a coach who retries an approved import writes it twice.

Applying a migration is not the same as shipping a feature.

## Previously applied from here

- `intake_apply.sql` — the atomic write path for Player Intake (C2). Applied
  as `20260823190858_intake_apply`. That migration file is now the single
  authoritative copy; its header carries the design rationale, so it is not
  repeated here.
