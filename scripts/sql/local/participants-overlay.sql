-- Mirrors production tournament_participants shape and write policy for the local attendance tests. Local fixture only.
alter table public.tournament_participants add column if not exists organization_id uuid, add column if not exists season_id uuid, add column if not exists positions text[], add column if not exists notes text, add column if not exists added_by uuid, add column if not exists created_at timestamptz default now();
update public.tournament_participants tp set organization_id = t.organization_id, season_id = t.season_id from public.tournaments t where t.id = tp.tournament_id;
drop policy if exists "tournament_participants: read" on public.tournament_participants;
create policy "participants: season read" on public.tournament_participants for select
  using (season_id in (select auth_season_ids()) and (coalesce((select auth_org_role()), '') <> 'parent' or player_id in (select auth_linked_player_ids())));
create policy "participants: season write" on public.tournament_participants for all
  using (season_id in (select auth_season_ids()) and (select auth_can_write()))
  with check (season_id in (select auth_season_ids()) and (select auth_can_write()));
create unique index if not exists tournament_participants_one_per_player on public.tournament_participants (tournament_id, player_id);
alter table public.players add column if not exists grad_year integer;
-- Mirrors production "players: org write" (rls_04) so addPickup can create a player locally.
create policy "players: org write" on public.players for all
  using (organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (organization_id = (select auth_organization_id()) and (select auth_can_write()));
alter table public.games add column if not exists start_time time, add column if not exists field text, add column if not exists game_type text, add column if not exists location text, add column if not exists our_score integer, add column if not exists opponent_score integer, add column if not exists qab_completed_at timestamptz, add column if not exists qab_completed_by uuid;
alter table public.games add column if not exists runs_for integer, add column if not exists runs_against integer, add column if not exists result text;
alter table public.plate_appearances add column if not exists is_qab boolean generated always as (cardinality(qab_reasons) > 0) stored;
