# Pending migrations

SQL that has been designed and reviewed but **not applied to production**.

A file here is not a migration yet. It moves to `supabase/migrations/` only
after it has been applied through the MCP tool and named with the version
Supabase actually recorded — the process established in B0 that keeps the
repository and production history aligned.

## intake_apply.sql

The atomic write path for Player Intake (C2). Reviewed and approved; **not
applied**.

Key properties, all deliberate:

- `SECURITY INVOKER`, against the local precedent that every other RPC uses
  `DEFINER`. `DEFINER` would bypass RLS on `players`, `team_season_players`,
  `player_contacts` and `player_links` — including the B3 policies — leaving
  the function as the only guard. As `INVOKER` it inherits every policy.
- Whole-import atomicity. A function body is one transaction, so any exception
  rolls back every row. The coach approved a reviewed set, not N independent
  operations.
- Executes decisions, makes none. Identity, conflict resolution, contact
  identity, primary selection and `full_name` are all decided in the reviewed
  plan and validated here.
- Fail-closed on every payload-driven operation: contact `op`, `link_type` and
  `is_new` each raise on anything unrecognised rather than defaulting to a
  mutation.
- No parameter can name a table.
- `revoke ... from public, anon` then `grant execute ... to authenticated`.

**Before applying:** `lib/actions/intake.js` calls this function. Until it is
applied, that action fails at the RPC call. Nothing invokes it — Import is
disabled in the UI — so the repository is consistent either way.

**Still required before enabling Import:** C3 idempotency (`intake_runs`), so a
repeated approved import cannot write twice.
