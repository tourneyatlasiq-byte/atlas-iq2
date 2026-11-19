-- LOCAL TEST FIXTURE ONLY. Lineup and plate appearance tables, reduced to the
-- columns the lineup actions and the tracker read. Constraints, row security
-- policies and the attribution trigger are copied from production migrations
-- qab_01 and qab_04 (20260813211355, 20260814181219). Loaded after
-- mark-paid-schema.sql and roster-seed.sql.

-- stand-in for the organization feature flag (production: auth_org_has_feature)
create table public.test_features (organization_id uuid, feature text);
create function public.auth_org_has_feature(p text) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from test_features f where f.organization_id = (select auth_organization_id()) and f.feature = p) $$;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text not null, person_type text not null default 'player', archived_at timestamptz
);
create table public.games (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references seasons(id),
  tournament_id uuid references tournaments(id) on delete set null,
  opponent_name text, game_date date default current_date
);
create table public.tournament_participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  jersey_number int, participation text default 'roster'
);

create table public.game_lineup_slots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id       uuid not null references public.seasons(id),
  game_id         uuid not null references public.games(id) on delete cascade,
  player_id       uuid not null references public.players(id) on delete cascade,
  batting_order   smallint not null check (batting_order between 1 and 40),
  created_at      timestamptz not null default now(),
  unique (game_id, batting_order),
  unique (game_id, player_id)
);
create table public.plate_appearances (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id       uuid not null references public.seasons(id),
  game_id         uuid not null references public.games(id) on delete cascade,
  player_id       uuid not null references public.players(id) on delete restrict,
  pa_number       smallint not null check (pa_number between 1 and 20),
  inning          smallint check (inning between 1 and 30),
  qab_reasons     text[] not null default '{}',
  recorded_by     uuid,
  created_at      timestamptz not null default now(),
  voided_at       timestamptz, voided_by uuid,
  batting_order   smallint check (batting_order is null or batting_order between 1 and 40)
);
create unique index plate_appearances_natural_key on public.plate_appearances (game_id, player_id, pa_number) where voided_at is null;

-- qab_04: where a batter batted is frozen at the moment of the at-bat
create function public.enforce_pa_attribution() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if TG_OP = 'INSERT' then return new; end if;
  new.recorded_by := old.recorded_by;
  new.batting_order := old.batting_order;
  return new;
end; $$;
create trigger pa_attribution before insert or update on public.plate_appearances for each row execute function public.enforce_pa_attribution();

create trigger season_write_policy before insert or update or delete on public.game_lineup_slots for each row execute function public.enforce_season_write_policy('season_id');
create trigger season_write_policy before insert or update or delete on public.plate_appearances for each row execute function public.enforce_season_write_policy('season_id');

alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.game_lineup_slots enable row level security;
alter table public.plate_appearances enable row level security;
create policy "players: org read" on public.players for select using (organization_id = (select auth_organization_id()));
create policy "games: season read" on public.games for select using (season_id in (select auth_season_ids()));
create policy "tournament_participants: read" on public.tournament_participants for select
  using (tournament_id in (select id from tournaments where season_id in (select auth_season_ids())));

create policy "game_lineup_slots: season read" on public.game_lineup_slots for select
  using ((select public.auth_org_has_feature('qab')) and season_id in (select public.auth_season_ids())
    and (coalesce((select public.auth_org_role()), '') <> 'parent' or player_id in (select public.auth_linked_player_ids())));
create policy "game_lineup_slots: season write" on public.game_lineup_slots for all
  using ((select public.auth_org_has_feature('qab')) and season_id in (select public.auth_season_ids()) and (select public.auth_can_write()))
  with check ((select public.auth_org_has_feature('qab')) and season_id in (select public.auth_season_ids()) and (select public.auth_can_write()));
create policy "plate_appearances: season read" on public.plate_appearances for select
  using ((select public.auth_org_has_feature('qab')) and season_id in (select public.auth_season_ids())
    and (coalesce((select public.auth_org_role()), '') <> 'parent' or player_id in (select public.auth_linked_player_ids())));
create policy "plate_appearances: season write" on public.plate_appearances for all
  using ((select public.auth_org_has_feature('qab')) and season_id in (select public.auth_season_ids()) and (select public.auth_can_write()))
  with check ((select public.auth_org_has_feature('qab')) and season_id in (select public.auth_season_ids()) and (select public.auth_can_write()));
