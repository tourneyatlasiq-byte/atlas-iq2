-- Staff are never participants. An event roster is who dressed to play.
--
-- The interface already filters them out of the picker; this makes it
-- impossible rather than merely unoffered, so a direct API call cannot record
-- a coach as having played.
--
-- Uses players.person_type — the same authoritative field deriveSummary() and
-- the Team readiness rules read. No second classification.

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
  p_type text;
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

  -- 1. The season must be the tournament's own season.
  if new.season_id is distinct from t_season then
    raise exception 'The season does not match this tournament''s season.'
      using errcode = 'check_violation';
  end if;

  -- 2. The organization must be the tournament's own.
  if new.organization_id is distinct from t_org then
    raise exception 'The organization does not match this tournament''s.'
      using errcode = 'check_violation';
  end if;

  -- 3. The player must belong to that organization, and must be a player.
  select organization_id, person_type into p_org, p_type
    from players where id = new.player_id;

  if p_org is null then
    raise exception 'That player could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if p_org is distinct from t_org then
    raise exception 'That player belongs to a different organization.'
      using errcode = 'check_violation';
  end if;

  -- Coaches, managers and other staff are on the roster but never dress as
  -- participants. person_type is the authoritative source, shared with the
  -- roster counts and readiness rules.
  if p_type is distinct from 'player' then
    raise exception 'Only players can be added to an event roster. Coaches and staff are not participants.'
      using errcode = 'check_violation';
  end if;

  -- 4. participation must mean what it says, both ways.
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

  -- 5. Past seasons are read-only. Future/planning seasons are writable.
  --    Mirrors seasonPhase() in lib/context.js, including the ordering key.
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

  -- 6. added_by is derived, never accepted from the client.
  if auth.uid() is not null then
    new.added_by := auth.uid();
  end if;

  return new;
end;
$$;

comment on function enforce_participant_integrity() is
  'Validates season/organization/player consistency, that the person is a
   player rather than staff, the meaning of participation, past-season
   read-only, and derives added_by from auth.uid().';
