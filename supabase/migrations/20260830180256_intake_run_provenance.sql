-- Import provenance: what the system was asked to do, and what it decided.
--
-- intake_runs recorded a fingerprint and aggregate counts. Twice now that has
-- been too little: an audit could not say which source columns a coach had
-- included, how many candidates the match ran against, or why a particular row
-- was created rather than matched. Both investigations ended at "cannot be
-- determined from the available evidence".
--
-- WHAT IS STORED, AND WHAT IS DELIBERATELY NOT.
--
-- `mapping` holds the coach's column HEADERS and the destination each was
-- given, plus the headers that were ignored, plus how many candidates the
-- match ran against. Headers are the labels in the coach's own spreadsheet --
-- "Player Name", "Email" -- not the values underneath them. No cell content.
--
-- `outcomes` holds one entry per row: its position in the file, what the
-- matcher classified it as, whether the coach supplied an explicit identity
-- choice, what the run did, and which player it touched. A player_id is an
-- internal identifier for a record this database already holds; without it an
-- audit cannot say WHICH player a decision applied to, which is the question
-- that stalled both investigations.
--
-- NOT stored: names, emails, dates of birth, phone numbers, addresses, or any
-- part of the uploaded file. A row's identity is reconstructed by joining
-- player_id, not by copying the person into an audit blob. If a player is
-- later deleted the audit keeps the decision and loses the pointer, which is
-- the correct trade for a record whose purpose is explaining system behaviour
-- rather than preserving personal data.
--
-- Both columns are NULLABLE. Existing rows keep their history and simply have
-- no provenance; nothing backfills invented detail.
alter table intake_runs
  add column if not exists mapping  jsonb,
  add column if not exists outcomes jsonb;

comment on column intake_runs.mapping is
  'Included column headers and their destinations, ignored headers, and the candidate count. Headers only -- never cell values.';
comment on column intake_runs.outcomes is
  'Per-row decision record: row index, classification, identity override, action taken, and player_id. No personal data.';

-- The wrapper gains two parameters, both defaulted, so the idempotency
-- contract is untouched.
create or replace function public.intake_apply_run(
  p_run_key             uuid,
  p_payload_fingerprint text,
  p_team_id             uuid,
  p_season_id           uuid,
  p_rows                jsonb,
  p_mapping             jsonb default null,
  p_outcomes            jsonb default null
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
  if p_payload_fingerprint is null or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'This import has an invalid content fingerprint.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'No rows to import.' using errcode = 'invalid_parameter_value';
  end if;
  v_rows := jsonb_array_length(p_rows);

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
    if v_run.organization_id <> v_org
       or v_run.team_id <> p_team_id
       or v_run.season_id <> p_season_id then
      raise exception 'That submission belongs to a different team or season.'
        using errcode = 'insufficient_privilege';
    end if;

    if v_run.payload_fingerprint <> p_payload_fingerprint then
      raise exception 'This import has changed since it was approved. Review it and submit again.'
        using errcode = 'invalid_parameter_value';
    end if;

    -- A REPLAY RECORDS NOTHING NEW. The provenance describes the run that
    -- actually did the work; writing it again on a retry would suggest a
    -- second import happened. The stored history stays as it was.
    return (v_run.result || jsonb_build_object('replayed', true))::json;
  end if;

  ----------------------------------------------------------------- 2. apply
  v_result := public.intake_apply(p_team_id, p_season_id, p_rows);

  ----------------------------------------------------------------- 3. claim
  insert into intake_runs (
    run_key, organization_id, team_id, season_id, created_by,
    payload_fingerprint, row_count, result, mapping, outcomes
  ) values (
    p_run_key, v_org, p_team_id, p_season_id, v_user,
    p_payload_fingerprint, v_rows, v_result::jsonb, p_mapping, p_outcomes
  )
  on conflict (run_key) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    raise exception 'This import was submitted twice at the same time. Nothing was duplicated -- please try again.'
      using errcode = 'invalid_parameter_value';
  end if;

  return (v_result::jsonb || jsonb_build_object('replayed', false))::json;
end;
$$;

revoke all on function public.intake_apply_run(uuid, text, uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.intake_apply_run(uuid, text, uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- The five-argument signature is dropped: leaving it would let a caller record
-- a run with no provenance and no error, which is the gap being closed.
drop function if exists public.intake_apply_run(uuid, text, uuid, uuid, jsonb);

comment on function public.intake_apply_run is
  'Idempotent entry point for Player Intake. Returns the stored result for a replayed run_key, fails closed when the same key carries different content, and relies on the unique index rather than a prior SELECT to settle concurrent submissions. Records column mapping and per-row decisions as provenance; a replay records nothing new. SECURITY INVOKER so RLS remains authoritative.';
