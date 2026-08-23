-- C3d: idempotency for Player Intake.
--
-- THE INVARIANT. The same approved import may be submitted repeatedly,
-- retried after a timeout, double-clicked or replayed without creating
-- duplicate players, memberships, contacts or links.
--
-- Without this, replay duplicates everything. Measured against production
-- before writing this migration: submitting one identical approved payload
-- twice produced 2 players, 2 memberships, 2 contacts and 2 links, and both
-- submissions reported success. The link dedup inside intake_apply and the
-- membership upsert are no protection, because a replayed new-player row gets
-- a fresh player_id and therefore collides with nothing.
--
-- THIS IS NOT PLAYER MATCHING. intake_runs answers "have I already executed
-- THIS approved operation", by key equality alone. It never inspects a
-- person's identity — that is lib/intake/match.js, and it runs inside each
-- import. Conflating them would make a coach importing the same athlete into
-- two seasons look like a replay.
--
-- NO PAYLOAD IS STORED. A run row holds a key, its scope, a digest, a row
-- count, five counters and a timestamp. No spreadsheet contents, no names, no
-- email addresses, no phone numbers, no mappings and no conflict decisions.
create table if not exists public.intake_runs (
  run_key             uuid primary key,
  organization_id     uuid not null references organizations(id) on delete cascade,
  team_id             uuid not null references teams(id)         on delete cascade,
  season_id           uuid not null references seasons(id)       on delete cascade,
  created_by          uuid references profiles(id) on delete set null,
  -- SHA-256, lowercase hex, of the canonical form of the approved operation.
  -- Constrained so a malformed or truncated digest cannot be stored and later
  -- compared as if it were meaningful.
  payload_fingerprint text not null,
  row_count           int  not null,
  result              jsonb not null,
  created_at          timestamptz not null default now(),
  constraint intake_runs_fingerprint_is_sha256
    check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint intake_runs_row_count_non_negative
    check (row_count >= 0)
);

-- Support lookup: "did this organization's import run, and when".
create index if not exists intake_runs_org_created_idx
  on public.intake_runs (organization_id, created_at desc);

alter table public.intake_runs enable row level security;

-- Explicit SELECT and INSERT only. There is deliberately no UPDATE policy: a
-- run row is written once, complete, and is never edited afterwards — an
-- amendable record of what already happened would defeat the point. There is
-- deliberately no DELETE policy either, following the same reasoning that
-- removed DELETE from players in #177; clearing these is an administrative
-- act, not something the application should be able to do.
drop policy if exists "intake_runs: org read" on public.intake_runs;
create policy "intake_runs: org read"
  on public.intake_runs
  for select
  using (
    organization_id = (select public.auth_organization_id())
    and (select public.auth_can_write())
  );

drop policy if exists "intake_runs: org insert" on public.intake_runs;
create policy "intake_runs: org insert"
  on public.intake_runs
  for insert
  with check (
    organization_id = (select public.auth_organization_id())
    and (select public.auth_can_write())
  );

comment on table public.intake_runs is
  'One row per completed player import. Records that an approved operation ran, never what was in it. run_key identifies the submission; payload_fingerprint proves the key is still attached to the approved content.';


-- The only path the application uses to apply an import.
--
-- A THIN WRAPPER. intake_apply() is unchanged and still does all the work.
-- Widening its signature would have created a second overload and left the
-- reviewed three-argument version live, requiring an explicit drop and
-- re-grant of the most carefully reviewed function in the schema. This adds a
-- layer instead of editing that one.
--
-- SECURITY INVOKER, so the nested intake_apply() call also runs as the caller
-- and every RLS policy still applies to every write.
--
-- ORDER OF OPERATIONS, and why. The completed result is inserted in a single
-- statement together with the work it describes, so there is no placeholder
-- row to amend and therefore no UPDATE policy on intake_runs:
--
--   1. Fast path — a committed run for this key is returned as-is. This is
--      what a double-click, a retry after a timeout and an ordinary resubmit
--      all take. No work is repeated and nothing is rewritten.
--   2. Otherwise the import runs.
--   3. The run row is claimed with ON CONFLICT (run_key) DO NOTHING. If a
--      concurrent transaction committed the same key while this one worked,
--      the insert affects zero rows and this transaction aborts — discarding
--      its duplicate writes along with it. The caller retries and takes the
--      fast path.
--
-- Two genuinely simultaneous submissions therefore cost one wasted execution
-- that is rolled back, and never a duplicate row. The unique index on run_key
-- is the arbiter, not a prior SELECT, which two concurrent callers could both
-- pass.
--
-- FAILURE DOES NOT CONSUME THE KEY. The run row and the roster writes share
-- one transaction, so a failure rolls back both and leaves no trace. A
-- corrected retry may reuse the same key.
create or replace function public.intake_apply_run(
  p_run_key             uuid,
  p_payload_fingerprint text,
  p_team_id             uuid,
  p_season_id           uuid,
  p_rows                jsonb
)
returns json
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_user     uuid := auth.uid();
  v_org      uuid := public.auth_organization_id();
  v_run      public.intake_runs%rowtype;
  v_result   json;
  v_rows     int;
  v_inserted int;
begin
  ------------------------------------------------------------------ identity
  if v_user is null then
    raise exception 'You must be signed in to import players.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'Your account is not attached to an organization.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.auth_can_write() then
    raise exception 'Your role does not allow changes to the roster.'
      using errcode = 'insufficient_privilege';
  end if;

  ------------------------------------------------------------------ contract
  if p_run_key is null then
    raise exception 'This import is missing its submission key.'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Validated here as well as by the CHECK, so a malformed digest is refused
  -- before any work rather than at the final insert.
  if p_payload_fingerprint is null or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'This import has an invalid content fingerprint.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'No rows to import.' using errcode = 'invalid_parameter_value';
  end if;
  v_rows := jsonb_array_length(p_rows);

  -- Checked before a run row is recorded against this team and season.
  -- intake_apply() checks it again; this is not redundant, because the run row
  -- is scoped to values that must be verified before it is written.
  if not exists (
    select 1 from seasons s join teams t on t.id = s.team_id
    where s.id = p_season_id and t.id = p_team_id and t.organization_id = v_org
  ) then
    raise exception 'That team and season do not belong to your organization.'
      using errcode = 'insufficient_privilege';
  end if;

  ------------------------------------------------------------- 1. fast path
  select * into v_run from intake_runs where run_key = p_run_key;

  if found then
    -- Scope must match. A key approved for one team and season cannot be
    -- replayed into another.
    if v_run.organization_id <> v_org
       or v_run.team_id <> p_team_id
       or v_run.season_id <> p_season_id then
      raise exception 'That submission belongs to a different team or season.'
        using errcode = 'insufficient_privilege';
    end if;

    -- FAIL CLOSED. Returning the earlier result for changed content would
    -- silently discard the coach's corrections and report success.
    if v_run.payload_fingerprint <> p_payload_fingerprint then
      raise exception 'This import has changed since it was approved. Review it and submit again.'
        using errcode = 'invalid_parameter_value';
    end if;

    return (v_run.result || jsonb_build_object('replayed', true))::json;
  end if;

  ----------------------------------------------------------------- 2. apply
  v_result := public.intake_apply(p_team_id, p_season_id, p_rows);

  ----------------------------------------------------------------- 3. claim
  insert into intake_runs (
    run_key, organization_id, team_id, season_id, created_by,
    payload_fingerprint, row_count, result
  ) values (
    p_run_key, v_org, p_team_id, p_season_id, v_user,
    p_payload_fingerprint, v_rows, v_result::jsonb
  )
  on conflict (run_key) do nothing;

  get diagnostics v_inserted = row_count;

  -- Zero means another transaction committed this key while this one was
  -- working. Raising discards everything written above, so the duplicate never
  -- reaches the table; the retry finds the committed run and takes the fast
  -- path.
  if v_inserted = 0 then
    raise exception 'This import was submitted twice at the same time. Nothing was duplicated — please try again.'
      using errcode = 'invalid_parameter_value';
  end if;

  return (v_result::jsonb || jsonb_build_object('replayed', false))::json;
end;
$$;

revoke all on function public.intake_apply_run(uuid, text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.intake_apply_run(uuid, text, uuid, uuid, jsonb) to authenticated;

comment on function public.intake_apply_run is
  'Idempotent entry point for Player Intake. Returns the stored result for a replayed run_key, fails closed when the same key carries different content, and relies on the unique index rather than a prior SELECT to settle concurrent submissions. SECURITY INVOKER so RLS remains authoritative.';
