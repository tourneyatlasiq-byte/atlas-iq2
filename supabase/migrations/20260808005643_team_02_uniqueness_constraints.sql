-- A player must never be assigned to the same season twice.
alter table team_season_players
  drop constraint if exists team_season_players_player_season_unique;
alter table team_season_players
  add constraint team_season_players_player_season_unique unique (player_id, season_id);

-- One current season per TEAM. Different organizations (and different teams
-- within an organization) may each have their own current season.
drop index if exists idx_seasons_one_current_per_team;
create unique index idx_seasons_one_current_per_team
  on seasons (team_id) where is_current = true;
