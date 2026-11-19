-- LOCAL TEST FIXTURE ONLY. Fictional roster for the Make inactive / Make active
-- persistence test. Table shape is reduced to the columns the action touches;
-- the row-security policies are copied from production (rls_04 write policy,
-- guard_03 parent-scoped read policy) and the past-season trigger is attached.
create table public.team_season_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null, season_id uuid not null, player_id uuid not null,
  jersey_number int, is_active boolean not null default true
);
alter table public.team_season_players enable row level security;
create policy "team_season_players: team read" on public.team_season_players for select using (
  team_id in (select auth_team_ids())
  and (coalesce((select auth_org_role()),'') <> 'parent' or player_id in (select auth_linked_player_ids())));
create policy "team_season_players: team write" on public.team_season_players for all
  using (team_id in (select auth_team_ids()) and (select auth_can_write()))
  with check (team_id in (select auth_team_ids()) and (select auth_can_write()));
create trigger season_write_policy before insert or update or delete on public.team_season_players
  for each row execute function public.enforce_season_write_policy('season_id');
insert into team_season_players (id, team_id, season_id, player_id, jersey_number, is_active) values
 ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000101', 2, true),
 ('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000102', 3, true),
 ('d0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000103', 4, true);
