-- Every invariant tournament_participants depends on, in one place.
--
-- RLS decides who and which tenant. This decides whether the row makes sense.
-- Neither duplicates the other, and neither is sufficient alone: a direct API
-- call with a valid session passes RLS and would otherwise write nonsense.

create or replace function enforce_participant_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t_org uuid;
  t_season uuid;
  p_org uuid;
  s_current boolean;
  s_team uuid;
  s_key date;
  cur_key date;
  on_roster boolean;
begin
  select organization_id, season_id into t_org, t_season
    from tournaments where id = new.tournament_id;

  if t_org is null then
    raise exception 'That tournament could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  -- 1. The season must be the tournament's own season. Two columns that can
  --    disagree is two sources of truth.
  if new.season_id is distinct from t_season then
    raise exception 'The season does not match this tournament''s season.'
      using errcode = 'check_violation';
  end if;

  -- 2. The organization must be the tournament's own.
  if new.organization_id is distinct from t_org then
    raise exception 'The organization does not match this tournament''s.'
      using errcode = 'check_violation';
  end if;

  -- 3. The player must belong to that organization. This is what stops a
  --    direct call attaching another organization's player by UUID — RLS on
  --    players governs reads, not what may be referenced here.
  select organization_id into p_org from players where id = new.player_id;

  if p_org is null then
    raise exception 'That player could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if p_org is distinct from t_org then
    raise exception 'That player belongs to a different organization.'
      using errcode = 'check_violation';
  end if;

  -- 4. participation must mean what it says.
  --
  --    roster = someone on this season's roster who dressed for this event.
  --    pickup = someone who is not on this season's roster.
  --
  --    Enforced both ways. Without the second direction Atlas could record a
  --    regular roster player as a pickup and corrupt the historical meaning.
  --
  --    Note this is validated at write time. If a pickup is later added to the
  --    season roster, their earlier pickup rows stand — she genuinely was a
  --    pickup at that event, and rewriting history would be wrong.
  select exists (
    select 1 from team_season_players tsp
     where tsp.player_id = new.player_id
       and tsp.season_id = new.season_id
  ) into on_roster;

  if new.participation = 'roster' and not on_roster then
    raise exception 'That player is not on this season''s roster. Add them as a pickup instead.'
      using errcode = 'check_violation';
  end if;

  if new.participation = 'pickup' and on_roster then
    raise exception 'That player is already on this season''s roster, so they are not a pickup.'
      using errcode = 'check_violation';
  end if;

  -- 5. Past seasons are read-only.
  --
  --    Also enforced in requireSeasonContext(), but a direct table call
  --    bypasses the application entirely — verified, see ATLAS-DECISIONS.md.
  --    Future/planning seasons are deliberately writable.
  --
  --    This mirrors seasonPhase() in lib/context.js, including the
  --    coalesce(start_date, created_at) ordering key. If one changes, both must.
  select is_current, team_id, coalesce(start_date, created_at::date)
    into s_current, s_team, s_key
    from seasons where id = new.season_id;

  if not s_current then
    select coalesce(start_date, created_at::date) into cur_key
      from seasons where team_id = s_team and is_current limit 1;

    if cur_key is not null and s_key < cur_key then
      raise exception 'That season has finished and is read-only.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- 6. added_by is an audit field, so it is derived, never accepted. A valid
  --    foreign key is not the same as a trustworthy one.
  if auth.uid() is not null then
    new.added_by := auth.uid();
  end if;

  return new;
end;
$$;

create trigger participant_integrity
  before insert or update on tournament_participants
  for each row execute function enforce_participant_integrity();

comment on function enforce_participant_integrity() is
  'Validates season/organization/player consistency, the meaning of
   participation, past-season read-only, and derives added_by from auth.uid().';
