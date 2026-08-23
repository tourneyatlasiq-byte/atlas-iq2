-- Ordering within a day. Two games on the same date currently sort arbitrarily.
alter table games add column if not exists start_time time;

-- Third free-text field to drift in this schema, after paid_status and
-- person_type. Constrained before it accumulates variants.
alter table games drop constraint if exists games_game_type_check;
update games set game_type = 'Pool'
  where game_type is not null
    and game_type not in ('Pool','Bracket','Championship','Friendly','Scrimmage');
alter table games add constraint games_game_type_check
  check (game_type is null or game_type = any (array[
    'Pool','Bracket','Championship','Friendly','Scrimmage'
  ]));

-- Clear results on games that have not been played. These were seeded with
-- outcomes for September and October fixtures, which is why the Dashboard
-- could have reported a record for games that never happened.
update games
set result = null, runs_for = null, runs_against = null
where game_date > current_date
  and (result is not null or runs_for is not null or runs_against is not null);

-- Legacy misnamed FK: constrains organization_id, not team_id.
alter table games rename constraint games_team_id_fkey to games_organization_id_fkey;

create index if not exists idx_games_tournament_order on games (tournament_id, game_date, start_time);

comment on column games.result is
  'W/L/T. DERIVED from runs_for and runs_against whenever both are present —
   enforce_game_result_timing() overwrites it on write, so it can never
   contradict the score. Kept as a fallback for games recorded without a score.';

comment on column games.start_time is
  'Optional. Used with game_date for ordering within a tournament day.';
