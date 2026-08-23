-- The participant trigger carried its own copy of past/future logic. That copy
-- is now removed: season_write_policy governs phase for this table like every
-- other, and atlas_season_phase() is the single definition.
--
-- This trigger keeps only what is specific to participants: consistency
-- between tournament, season, organization and player, the meaning of
-- participation, players-not-staff, and deriving added_by.

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
  on_roster boolean;
begin
  select organization_id, season_id into t_org, t_season
    from tournaments where id = new.tournament_id;

  if t_org is null then
    raise exception 'That tournament could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if new.season_id is distinct from t_season then
    raise exception 'The season does not match this tournament''s season.'
      using errcode = 'check_violation';
  end if;

  if new.organization_id is distinct from t_org then
    raise exception 'The organization does not match this tournament''s.'
      using errcode = 'check_violation';
  end if;

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

  -- Staff are on the roster but never dress. players.person_type is the
  -- authoritative source, shared with roster counts and readiness rules.
  if p_type is distinct from 'player' then
    raise exception 'Only players can be added to an event roster. Coaches and staff are not participants.'
      using errcode = 'check_violation';
  end if;

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

  -- Season phase is no longer checked here. season_write_policy owns it.

  if auth.uid() is not null then
    new.added_by := auth.uid();
  end if;

  return new;
end;
$$;

comment on function enforce_participant_integrity() is
  'Participant-specific rules only: tournament/season/organization consistency,
   player-not-staff, the meaning of participation, and deriving added_by.
   Season phase is enforced by enforce_season_write_policy().';
