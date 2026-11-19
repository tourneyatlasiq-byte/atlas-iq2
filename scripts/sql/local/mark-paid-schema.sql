-- LOCAL TEST FIXTURE ONLY. Never applied to Supabase.
--
-- A minimal copy of the parts of the production schema that
-- supabase/pending/mark_tournament_paid_in_full.sql touches: the tables and
-- columns, the check constraints, the row-level-security policies, the budget
-- link trigger and the past-season trigger (as defined in production on
-- 2026-11-19), and stand-ins for the auth helpers. Everything is fictional.
drop schema if exists auth cascade;
drop schema if exists public cascade;
create schema auth;
create schema public;
grant usage on schema public to public;
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to public;

create function auth.uid() returns uuid language sql stable as
  $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub','')::uuid $$;

create table public.organizations (id uuid primary key default gen_random_uuid(), name text);
create table public.seasons (id uuid primary key default gen_random_uuid(), team_id uuid not null, name text, phase text not null default 'current');
-- stand-in for membership: which user belongs to which team with which role
create table public.test_memberships (user_id uuid, organization_id uuid, legacy_role text);

create function public.auth_active_membership() returns table(organization_id uuid, legacy_role text)
  language sql stable security definer set search_path = public as
  $$ select m.organization_id, m.legacy_role from test_memberships m where m.user_id = auth.uid() limit 1 $$;
create function public.auth_can_write() returns boolean language sql stable security definer set search_path = public as
  $$ select coalesce((select legacy_role from auth_active_membership()) in ('owner','admin','coach','manager'), false) $$;
create function public.auth_org_role() returns text language sql stable security definer set search_path = public as
  $$ select legacy_role from auth_active_membership() $$;
create function public.auth_organization_id() returns uuid language sql stable security definer set search_path = public as
  $$ select organization_id from auth_active_membership() $$;
create function public.auth_team_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select organization_id from auth_active_membership() $$;
create function public.auth_season_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select s.id from seasons s where s.team_id in (select auth_team_ids()) $$;
create function public.auth_is_org_admin() returns boolean language sql stable security definer set search_path = public as
  $$ select coalesce((select legacy_role from auth_active_membership()) in ('owner','admin'), false) $$;
create function public.atlas_season_phase(p uuid) returns text language sql stable security definer set search_path = public as
  $$ select phase from seasons where id = p $$;

create table public.budget_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  season_id uuid references seasons(id),
  category text not null, name text, is_income boolean not null default false,
  budgeted numeric default 0,
  quantity numeric(10, 2), unit_cost numeric(12, 2), notes text
);
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  season_id uuid references seasons(id),
  name text not null,
  entry_fee numeric default 0, gate_fee numeric default 0,
  total_cost numeric generated always as (entry_fee + gate_fee) stored,
  decision text default 'Considering' check (decision = any (array['Considering','Committed','Declined'])),
  paid_status text default 'Not Registered' check (paid_status = any (array['Not Registered','Waitlisted','Registered','Deposit Paid','Paid in Full'])),
  budget_item_id uuid references budget_items(id) on delete restrict,
  start_date date, end_date date
);
create table public.budget_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  tournament_id uuid references tournaments(id) on delete set null,
  category text not null, txn_date date default current_date, vendor text, item text not null,
  quantity numeric default 1, budgeted_amount numeric default 0, actual_amount numeric default 0,
  status text not null default 'Paid' check (status = any (array['To Pay','Paid'])),
  notes text, created_at timestamptz default now(),
  season_id uuid references seasons(id), is_income boolean not null default false,
  budget_item_id uuid references budget_items(id) on delete restrict,
  receipt_path text, player_id uuid, facility_id uuid
);
create table public.player_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  player_id uuid, player_name text,
  initial_cost numeric not null default 0,
  season_id uuid references seasons(id),
  exempt boolean not null default false,
  check ((not exempt) or (initial_cost = 0))
);
create table public.payment_log (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references player_payments(id) on delete restrict,
  month_label text, amount numeric not null, paid_date date default current_date
);

-- production triggers (copied)
create function public.enforce_tournament_budget_link() returns trigger language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if new.budget_item_id is null then return new; end if;
  select season_id, is_income, organization_id into b from budget_items where id = new.budget_item_id;
  if b is null then raise exception 'That budget line could not be found.' using errcode = 'foreign_key_violation'; end if;
  if b.organization_id is distinct from new.organization_id then raise exception 'That budget line belongs to a different organization.' using errcode = 'check_violation'; end if;
  if b.season_id is distinct from new.season_id then raise exception 'That budget line belongs to a different season.' using errcode = 'check_violation'; end if;
  if b.is_income then raise exception 'Tournament costs belong to an expense budget line, not an income line.' using errcode = 'check_violation'; end if;
  return new;
end; $$;
create trigger tournament_budget_link_check before insert or update on public.tournaments
  for each row execute function public.enforce_tournament_budget_link();

create function public.enforce_season_write_policy() returns trigger language plpgsql security definer set search_path = public as $$
declare
  mode text := coalesce(TG_ARGV[0], 'season_id'); new_season uuid; old_season uuid; new_phase text; old_phase text; is_admin boolean;
begin
  if mode = 'via_payment' then
    if TG_OP <> 'DELETE' then select season_id into new_season from player_payments where id = NEW.payment_id; end if;
    if TG_OP <> 'INSERT' then select season_id into old_season from player_payments where id = OLD.payment_id; end if;
  else
    if TG_OP <> 'DELETE' then execute format('select ($1).%I', mode) into new_season using NEW; end if;
    if TG_OP <> 'INSERT' then execute format('select ($1).%I', mode) into old_season using OLD; end if;
  end if;
  new_phase := case when new_season is null then null else atlas_season_phase(new_season) end;
  old_phase := case when old_season is null then null else atlas_season_phase(old_season) end;
  if auth.uid() is null then return case when TG_OP = 'DELETE' then OLD else NEW end; end if;
  is_admin := auth_is_org_admin();
  if TG_OP = 'INSERT' then
    if new_phase = 'past' then raise exception 'That season has finished. New records can''t be added to it.' using errcode = 'check_violation'; end if;
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    if (old_phase = 'past' or new_phase = 'past') and not is_admin then raise exception 'Only an owner or admin can correct a finished season.' using errcode = 'insufficient_privilege'; end if;
    if old_phase is distinct from new_phase and (old_phase = 'past' or new_phase = 'past') then raise exception 'A record can''t be moved into or out of a finished season.' using errcode = 'check_violation'; end if;
    return NEW;
  end if;
  if TG_OP = 'DELETE' then
    if old_phase = 'past' and not is_admin then raise exception 'Only an owner or admin can remove a record from a finished season.' using errcode = 'insufficient_privilege'; end if;
    return OLD;
  end if;
  return NEW;
end; $$;
create trigger season_write_policy before insert or update or delete on public.tournaments for each row execute function public.enforce_season_write_policy('season_id');
create trigger season_write_policy before insert or update or delete on public.budget_items for each row execute function public.enforce_season_write_policy('season_id');
create trigger season_write_policy before insert or update or delete on public.budget_transactions for each row execute function public.enforce_season_write_policy('season_id');
create trigger season_write_policy before insert or update or delete on public.player_payments for each row execute function public.enforce_season_write_policy('season_id');
create trigger season_write_policy before insert or update or delete on public.payment_log for each row execute function public.enforce_season_write_policy('via_payment');

-- production RLS (copied)
alter table public.tournaments enable row level security;
alter table public.budget_transactions enable row level security;
alter table public.budget_items enable row level security;
create policy "tournaments: season read" on public.tournaments for select using (season_id in (select auth_season_ids()));
create policy "tournaments: season write" on public.tournaments for all
  using (season_id in (select auth_season_ids()) and (select auth_can_write()))
  with check (season_id in (select auth_season_ids()) and (select auth_can_write()));
create policy "budget_transactions: season read" on public.budget_transactions for select
  using ((season_id in (select auth_season_ids()) or (season_id is null and organization_id = (select auth_organization_id())))
         and coalesce((select auth_org_role()), '') <> 'parent');
create policy "budget_transactions: season write" on public.budget_transactions for all
  using ((season_id in (select auth_season_ids()) or (season_id is null and organization_id = (select auth_organization_id()))) and (select auth_can_write()))
  with check ((season_id in (select auth_season_ids()) or (season_id is null and organization_id = (select auth_organization_id()))) and (select auth_can_write()));
create policy "budget_items: season read" on public.budget_items for select using (season_id in (select auth_season_ids()));
create policy "budget_items: season write" on public.budget_items for all
  using (season_id in (select auth_season_ids()) and (select auth_can_write()))
  with check (season_id in (select auth_season_ids()) and (select auth_can_write()));

create function public.auth_linked_player_ids() returns setof uuid language sql stable security definer set search_path = public as $$ select null::uuid where false $$;
alter table public.player_payments enable row level security;
alter table public.payment_log enable row level security;
create policy "player_payments: season read" on public.player_payments for select
  using (season_id in (select auth_season_ids()) and (coalesce((select auth_org_role()), '') <> 'parent' or player_id in (select auth_linked_player_ids())));
create policy "player_payments: season write" on public.player_payments for all
  using (season_id in (select auth_season_ids()) and (select auth_can_write()))
  with check (season_id in (select auth_season_ids()) and (select auth_can_write()));
create policy "payment_log: season read" on public.payment_log for select
  using (payment_id in (select pp.id from player_payments pp where pp.season_id in (select auth_season_ids())
         and (coalesce((select auth_org_role()), '') <> 'parent' or pp.player_id in (select auth_linked_player_ids()))));
create policy "payment_log: season write" on public.payment_log for all
  using (payment_id in (select id from player_payments where season_id in (select auth_season_ids())) and (select auth_can_write()))
  with check (payment_id in (select id from player_payments where season_id in (select auth_season_ids())) and (select auth_can_write()));
