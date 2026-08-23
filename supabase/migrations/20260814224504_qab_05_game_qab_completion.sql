-- qab_05_game_qab_completion
--
-- Adds an explicit "the coach finished tracking this game" fact.
--
-- WHY THIS IS NOT DERIVED
-- Nothing in the existing model can stand in for it. games.result holds W/L
-- derived from the score and exists on games with zero plate appearances; a
-- recorded score is not a finished tracking session, and a finished session
-- does not require a score. Softball has no predetermined plate appearance
-- count — pool games end on time limits — so PA count, lineup rotation and
-- batting-order wraparound are all invalid signals. Completion is only ever an
-- explicit coach action.
--
-- WHY ON games AND NOT A SESSION TABLE
-- One fact about one game. A separate table would carry a foreign key, its own
-- RLS policies and its own lifecycle to hold a timestamp.
--
-- WHY qab_completed_by -> profiles ON DELETE SET NULL
-- Verified against the deployed schema rather than assumed. Actor columns here
-- are split: general tables reference profiles with SET NULL
-- (documents.uploaded_by, invites.created_by, tournament_participants.added_by,
-- facility_edits.*), while the QAB tables reference auth.users with NO ACTION.
-- profiles.id is auth.users.id, so both resolve to the same value.
--
-- games is a general table, so it follows its peers. SET NULL also means the
-- completion fact survives a coach leaving the organization — that the game was
-- finished matters more than who finished it — and, unlike NO ACTION, it does
-- not block deleting the user.

alter table public.games
  add column qab_completed_at timestamptz,
  add column qab_completed_by uuid references public.profiles(id) on delete set null;

comment on column public.games.qab_completed_at is
  'When a coach explicitly finished QAB tracking for this game. Null means not complete. Never inferred from plate appearance count, lineup rotation, score or elapsed time.';

comment on column public.games.qab_completed_by is
  'Who finished tracking. Nulled if the profile is removed; the completion itself survives.';

-- ---------------------------------------------------------------------------
-- Enforcement below the UI
-- ---------------------------------------------------------------------------
-- The server action is not the only write path: a direct PostgREST call with a
-- valid JWT reaches the table through RLS alone. RLS is the wrong place to add
-- this, because the write policy is FOR ALL and a completion condition there
-- would also block corrections, voids and restores.
--
-- enforce_pa_integrity() already loads the game row, so the check costs nothing
-- extra. It fires on INSERT only: a completed game must stay fully editable.
--
-- Body is otherwise identical to the deployed version.

create or replace function public.enforce_pa_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g_org uuid; g_season uuid; g_completed timestamptz; p_org uuid; p_type text;
begin
  select organization_id, season_id, qab_completed_at
    into g_org, g_season, g_completed
    from games where id = new.game_id;

  if g_org is null then
    raise exception 'That game could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  -- New plate appearances only. Corrections, voids and restores are UPDATEs
  -- and must keep working on a completed game.
  if TG_OP = 'INSERT' and g_completed is not null then
    raise exception 'QAB tracking is complete for this game. Resume tracking to record a new plate appearance.'
      using errcode = 'check_violation';
  end if;

  if new.season_id is distinct from g_season then
    raise exception 'The season does not match this game''s season.'
      using errcode = 'check_violation';
  end if;

  if new.organization_id is distinct from g_org then
    raise exception 'The organization does not match this game''s.'
      using errcode = 'check_violation';
  end if;

  select organization_id, person_type into p_org, p_type
    from players where id = new.player_id;

  if p_org is null then
    raise exception 'That player could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if p_org is distinct from g_org then
    raise exception 'That player belongs to a different organization.'
      using errcode = 'check_violation';
  end if;

  if p_type is distinct from 'player' then
    raise exception 'Only players can have plate appearances.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
