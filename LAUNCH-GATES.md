# UNPROVEN LAUNCH GATE: simultaneous same-run-key concurrency

Status: **UNPROVEN**. Not simulated, not weakened, not worked around.

## What is proven

Sequential idempotency is fully verified. Re-submitting the same `run_key`
returns the stored result with `replayed: true`, writes nothing further, and a
failed import leaves no run row so the key stays reusable. The mechanism that
settles a genuine race is also verified in isolation: `intake_runs.run_key` is
the primary key, and `intake_apply_run()` claims it with
`ON CONFLICT (run_key) DO NOTHING`, aborting when it claims zero rows so its
duplicate writes roll back.

## What is NOT proven

TWO INDEPENDENT SESSIONS calling `intake_apply_run()` with the same `run_key`
AT THE SAME INSTANT has never been executed. The behaviour is argued from
documented PostgreSQL semantics, not observed.

## Why it cannot be run from this environment

Re-verified 2026-08-28:

| Route | Result |
|---|---|
| Supabase REST from the container | `403 x-deny-reason: host_not_allowed` |
| `www.seasontempo.com` from the container | `403 x-deny-reason: host_not_allowed` |
| `dblink` | available but NOT installed; connecting back needs a password this environment does not hold |
| `pg_background` | not available |
| `max_prepared_transactions` | `0` — no two-phase commit |
| Two MCP tool calls | executed sequentially, not concurrently |

A single database session cannot race itself, and no second session can be
opened from here.

## What would prove it

Any ONE of the following:

1. **Run the harness from a machine with network access** — the kit already
   exists (`concurrency-gate-test-kit`): a disposable organization, two
   independently authenticated Supabase clients firing the same `run_key`
   through a release barrier, the ten proofs as SQL, and a cascade cleanup.
   This is the cheapest and most faithful option: real PostgREST connections,
   real RLS, real network timing.

2. **Allow-list `iiyuagxdeafkxrtixktr.supabase.co`** in this environment's
   network settings, after which the same harness runs from here.

3. **`pg_cron`** — available but not installed. Two jobs scheduled on the same
   tick would execute in separate background workers, which is genuine
   concurrency. NOT RECOMMENDED without discussion: installing an extension in
   production is a schema change, cron workers run as a superuser so the
   SECURITY INVOKER path and RLS would have to be simulated with `set local`,
   and scheduling granularity makes the overlap window imprecise. It would
   prove the database primitive, not the coach's actual path.

## Expected result when it is run

Either both callers return counters (one `replayed: false`, one
`replayed: true`), OR one returns counters and the loser raises
"This import was submitted twice at the same time…" and its retry returns the
winner's counters. Both are passes. In either case there must be exactly one
`intake_runs` row, one player, one membership, one contact and one link.

A run that reports INCONCLUSIVE — no round overlapped tightly enough to race —
must NOT be recorded as a pass.
