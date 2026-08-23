-- ============================================================
-- STEP 1-2: Rename the two conflated "organization" concepts
-- ============================================================
alter table organizations rename to tournament_providers;
alter table teams rename to organizations;

-- ============================================================
-- STEP 3: Create the real Teams table
-- ============================================================
create table teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  is_placeholder_name boolean not null default false,
  created_at timestamptz default now()
);

insert into teams (organization_id, name, is_placeholder_name)
select id, 'Primary Team', true from organizations;

-- ============================================================
-- STEP 4: Create Seasons, backfill from legacy free-text season
-- ============================================================
create table seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  is_current boolean not null default true,
  is_placeholder boolean not null default false,
  created_at timestamptz default now()
);

insert into seasons (team_id, name, is_current, is_placeholder)
select
  t.id,
  coalesce(nullif(trim(o.season), ''), '2026-27'),
  true,
  (nullif(trim(o.season), '') is null)
from teams t
join organizations o on o.id = t.organization_id;

-- ============================================================
-- STEP 5: Create Players (persistent identity), backfill from roster
-- Reuse roster.id as players.id so existing FKs into roster
-- resolve identically once repointed to players.
-- ============================================================
create table players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  full_name text not null,
  person_type text default 'Player',
  other_role_label text,
  grad_year integer,
  date_of_birth date,
  player_phone text,
  player_email text,
  parent_email text,
  parent_phone text,
  notes text,
  created_at timestamptz default now()
);

insert into players (id, organization_id, full_name, person_type, other_role_label, grad_year, date_of_birth, player_phone, player_email, parent_email, parent_phone, notes)
select id, team_id, player_name, person_type, other_role_label, grad_year, date_of_birth, player_phone, player_email, parent_email, parent_phone, notes
from roster;

-- Repoint documents.player_id from roster -> players (values already match)
alter table documents drop constraint documents_player_id_fkey;
alter table documents add constraint documents_player_id_fkey
  foreign key (player_id) references players(id) on delete set null;

-- ============================================================
-- STEP 6: Create the Team+Season roster assignment join table
-- ============================================================
create table team_season_players (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  season_id uuid references seasons(id) on delete cascade,
  jersey_number integer,
  jersey_size text,
  pants_size text,
  position text,
  joined_at timestamptz default now()
);

insert into team_season_players (player_id, team_id, season_id, jersey_number, jersey_size, pants_size, position)
select r.id, t.id, s.id, r.jersey_number, r.jersey_size, r.pants_size, r.position
from roster r
join teams t on t.organization_id = r.team_id
join seasons s on s.team_id = t.id;

-- ============================================================
-- STEP 7: Add season_id to leaf tables, backfill unambiguously
-- (each org today has exactly one team and one season)
-- ============================================================
alter table tournaments add column season_id uuid references seasons(id);
alter table games add column season_id uuid references seasons(id);
alter table budget_transactions add column season_id uuid references seasons(id);
alter table payments add column season_id uuid references seasons(id);
alter table documents add column season_id uuid references seasons(id);

update tournaments t set season_id = s.id
  from teams tm join seasons s on s.team_id = tm.id
  where tm.organization_id = t.team_id;
update games g set season_id = s.id
  from teams tm join seasons s on s.team_id = tm.id
  where tm.organization_id = g.team_id;
update budget_transactions bt set season_id = s.id
  from teams tm join seasons s on s.team_id = tm.id
  where tm.organization_id = bt.team_id;
update payments p set season_id = s.id
  from teams tm join seasons s on s.team_id = tm.id
  where tm.organization_id = p.team_id;
update documents d set season_id = s.id
  from teams tm join seasons s on s.team_id = tm.id
  where tm.organization_id = d.team_id;

-- ============================================================
-- STEP 8: Fix the tournament-provider relationship name
-- ============================================================
alter table tournaments rename column organization_id to tournament_provider_id;

-- ============================================================
-- STEP 9: Rename payments -> player_payments, link to real players
-- ============================================================
alter table payments rename to player_payments;

update player_payments pp set player_id = pl.id
from players pl
where pl.organization_id = pp.team_id
  and lower(trim(pl.full_name)) = lower(trim(pp.player_name))
  and pp.player_id is null;

alter table player_payments drop constraint payments_player_id_fkey;
alter table player_payments add constraint player_payments_player_id_fkey
  foreign key (player_id) references players(id) on delete set null;

-- ============================================================
-- STEP 10: Rename team_id -> organization_id everywhere it means
-- "which tenant owns this row" (FKs auto-follow table renames,
-- so this is a pure relabel with zero data movement)
-- ============================================================
alter table profiles rename column team_id to organization_id;
alter table invites rename column team_id to organization_id;
alter table roster rename column team_id to organization_id;
alter table tournaments rename column team_id to organization_id;
alter table budget_transactions rename column team_id to organization_id;
alter table documents rename column team_id to organization_id;
alter table games rename column team_id to organization_id;
alter table player_payments rename column team_id to organization_id;
alter table budget_items rename column team_id to organization_id;
alter table player_stats rename column team_id to organization_id;

-- Facilities and Tournament Providers become canonical/shared records,
-- so their tenant column becomes provenance-only, not a security scope.
alter table facilities rename column team_id to created_by_organization_id;
alter table tournament_providers rename column team_id to created_by_organization_id;

-- ============================================================
-- STEP 11: Deduplicate Tournament Providers by name, repoint FKs
-- ============================================================
create temp table tp_canonical as
select lower(trim(name)) as key, (array_agg(id order by id))[1] as canonical_id
from tournament_providers
group by lower(trim(name));

update tournaments t
set tournament_provider_id = c.canonical_id
from tournament_providers tp
join tp_canonical c on c.key = lower(trim(tp.name))
where tp.id = t.tournament_provider_id;

delete from tournament_providers tp
where tp.id not in (select canonical_id from tp_canonical);

drop table tp_canonical;

-- ============================================================
-- STEP 12: Forward-looking permissions plumbing (not enforced yet)
-- ============================================================
create table team_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  role text not null,
  created_at timestamptz default now()
);

alter table invites add column team_id uuid references teams(id);

-- ============================================================
-- STEP 13: RLS — rename the core auth helper, add policies for
-- new tables, and open up Facilities/Tournament Providers as
-- shared canonical records (read: any signed-in user; write:
-- restricted to the creating org's coach/manager).
-- ============================================================
alter function auth_team_id() rename to auth_organization_id;
create or replace function public.auth_organization_id()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select organization_id from profiles where id = auth.uid();
$function$;

-- Drop dead demo-era policies left over from before auth existed
drop policy if exists "TEMP demo read - remove after auth is added" on budget_items;
drop policy if exists "TEMP demo read - remove after auth is added" on facilities;
drop policy if exists "TEMP demo read - remove after auth is added" on games;
drop policy if exists "TEMP demo read - remove after auth is added" on tournament_providers;
drop policy if exists "TEMP demo read - remove after auth is added" on payment_log;
drop policy if exists "TEMP demo read - remove after auth is added" on player_payments;
drop policy if exists "TEMP demo read - remove after auth is added" on roster;
drop policy if exists "TEMP demo read - remove after auth is added" on tournaments;

-- Facilities: shared canonical records
drop policy if exists "facilities: team read" on facilities;
drop policy if exists "facilities: coach/manager write" on facilities;
create policy "facilities: any authenticated user can read" on facilities
  for select using (auth.uid() is not null);
create policy "facilities: any coach/manager can create" on facilities
  for insert with check ((select role from profiles where id = auth.uid()) in ('coach','manager'));
create policy "facilities: creating org can modify own" on facilities
  for update using (created_by_organization_id = auth_organization_id() and (select role from profiles where id = auth.uid()) in ('coach','manager'));
create policy "facilities: creating org can delete own" on facilities
  for delete using (created_by_organization_id = auth_organization_id() and (select role from profiles where id = auth.uid()) in ('coach','manager'));

-- Tournament Providers: shared canonical records
drop policy if exists "organizations: team read" on tournament_providers;
drop policy if exists "organizations: coach/manager write" on tournament_providers;
create policy "tournament_providers: any authenticated user can read" on tournament_providers
  for select using (auth.uid() is not null);
create policy "tournament_providers: any coach/manager can create" on tournament_providers
  for insert with check ((select role from profiles where id = auth.uid()) in ('coach','manager'));
create policy "tournament_providers: creating org can modify own" on tournament_providers
  for update using (created_by_organization_id = auth_organization_id() and (select role from profiles where id = auth.uid()) in ('coach','manager'));
create policy "tournament_providers: creating org can delete own" on tournament_providers
  for delete using (created_by_organization_id = auth_organization_id() and (select role from profiles where id = auth.uid()) in ('coach','manager'));

-- Cosmetic: relabel the renamed tenant table's own policies
alter policy "teams: authenticated can create" on organizations rename to "organizations: authenticated can create";
alter policy "teams: coach/manager update own" on organizations rename to "organizations: coach/manager update own";
alter policy "teams: view own" on organizations rename to "organizations: view own";

-- New tables: RLS
alter table teams enable row level security;
create policy "teams: org read" on teams
  for select using (organization_id = auth_organization_id());
create policy "teams: org coach/manager write" on teams
  for all using (organization_id = auth_organization_id() and (select role from profiles where id = auth.uid()) in ('coach','manager'));

alter table seasons enable row level security;
create policy "seasons: org read" on seasons
  for select using (exists (select 1 from teams t where t.id = seasons.team_id and t.organization_id = auth_organization_id()));
create policy "seasons: org coach/manager write" on seasons
  for all using (
    exists (select 1 from teams t where t.id = seasons.team_id and t.organization_id = auth_organization_id())
    and (select role from profiles where id = auth.uid()) in ('coach','manager')
  );

alter table players enable row level security;
create policy "players: org read" on players
  for select using (organization_id = auth_organization_id());
create policy "players: org coach/manager write" on players
  for all using (organization_id = auth_organization_id() and (select role from profiles where id = auth.uid()) in ('coach','manager'));

alter table team_season_players enable row level security;
create policy "team_season_players: org read" on team_season_players
  for select using (exists (select 1 from teams t where t.id = team_season_players.team_id and t.organization_id = auth_organization_id()));
create policy "team_season_players: org coach/manager write" on team_season_players
  for all using (
    exists (select 1 from teams t where t.id = team_season_players.team_id and t.organization_id = auth_organization_id())
    and (select role from profiles where id = auth.uid()) in ('coach','manager')
  );

alter table team_memberships enable row level security;
create policy "team_memberships: org read" on team_memberships
  for select using (exists (select 1 from teams t where t.id = team_memberships.team_id and t.organization_id = auth_organization_id()));
create policy "team_memberships: org coach/manager write" on team_memberships
  for all using (
    exists (select 1 from teams t where t.id = team_memberships.team_id and t.organization_id = auth_organization_id())
    and (select role from profiles where id = auth.uid()) in ('coach','manager')
  );
