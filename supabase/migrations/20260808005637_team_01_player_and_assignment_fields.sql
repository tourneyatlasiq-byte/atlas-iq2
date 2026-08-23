-- ---- Persistent player identity ----
alter table players add column if not exists throws text;
alter table players add column if not exists bats text;
alter table players add column if not exists parent_name text;

alter table players drop constraint if exists players_throws_check;
alter table players add constraint players_throws_check
  check (throws is null or throws = any (array['R','L']));

alter table players drop constraint if exists players_bats_check;
alter table players add constraint players_bats_check
  check (bats is null or bats = any (array['R','L','S']));

-- person_type had no constraint and had already drifted ('player' and 'Player').
update players set person_type = lower(trim(person_type)) where person_type is not null;
update players set person_type = 'player' where person_type is null or person_type = '';
update players set person_type = 'other'
  where person_type not in ('player','coach','manager','other');

alter table players drop constraint if exists players_person_type_check;
alter table players add constraint players_person_type_check
  check (person_type = any (array['player','coach','manager','other']));
alter table players alter column person_type set default 'player';

-- ---- Season assignment ----
alter table team_season_players add column if not exists is_active boolean not null default true;
alter table team_season_players add column if not exists positions text[];

-- Backfill the singular position into the array. The legacy column stays.
update team_season_players
set positions = array[position]
where position is not null and position <> '' and positions is null;

comment on column team_season_players.position is
  'LEGACY. Superseded by positions text[]. Retained for compatibility; the Team module reads positions.';
comment on column team_season_players.is_active is
  'Season-specific roster status. A player inactive one season may be active the next.';
