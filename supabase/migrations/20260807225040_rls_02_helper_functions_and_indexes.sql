-- SECURITY DEFINER is required: these read profiles/team_memberships, which
-- are themselves RLS-protected. Invoker rights would recurse.

create or replace function public.auth_org_role()
returns text language sql stable security definer set search_path to 'public' as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.auth_is_org_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select role from profiles where id = auth.uid()) in ('owner','admin'), false);
$$;

-- Admins get every team in their organization; everyone else gets only the
-- teams they are explicitly a member of. No membership means no access.
create or replace function public.auth_team_ids()
returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select t.id
  from teams t
  where t.organization_id = (select organization_id from profiles where id = auth.uid())
    and (
      (select role from profiles where id = auth.uid()) in ('owner','admin')
      or exists (
        select 1 from team_memberships m
        where m.team_id = t.id and m.profile_id = auth.uid()
      )
    );
$$;

-- Season is the authoritative join for team-owned records.
create or replace function public.auth_season_ids()
returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select s.id from seasons s where s.team_id in (select auth_team_ids());
$$;

create or replace function public.auth_can_write()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select role from profiles where id = auth.uid())
                  in ('owner','admin','coach','manager'), false);
$$;

create index if not exists idx_team_memberships_profile on team_memberships (profile_id);
create index if not exists idx_team_memberships_team on team_memberships (team_id);
create index if not exists idx_seasons_team on seasons (team_id);
create index if not exists idx_tournaments_season on tournaments (season_id);
create index if not exists idx_games_season on games (season_id);
create index if not exists idx_player_payments_season on player_payments (season_id);
create index if not exists idx_budget_transactions_season on budget_transactions (season_id);
create index if not exists idx_documents_season on documents (season_id);
create index if not exists idx_team_season_players_season on team_season_players (season_id);
create index if not exists idx_payment_log_payment on payment_log (payment_id);
