-- ============ SEASON-SCOPED TABLES ============
-- Scope: season_id IN auth_season_ids(), falling back to organization scope
-- when season_id IS NULL so org-level records don't disappear.

drop policy if exists "tournaments: team read" on tournaments;
drop policy if exists "tournaments: coach/manager write" on tournaments;
create policy "tournaments: season read" on tournaments for select
  using (season_id in (select auth_season_ids()));
create policy "tournaments: season write" on tournaments for all
  using (season_id in (select auth_season_ids()) and (select auth_can_write()))
  with check (season_id in (select auth_season_ids()) and (select auth_can_write()));

drop policy if exists "games: team read" on games;
drop policy if exists "games: coach/manager write" on games;
create policy "games: season read" on games for select
  using (season_id in (select auth_season_ids()));
create policy "games: season write" on games for all
  using (season_id in (select auth_season_ids()) and (select auth_can_write()))
  with check (season_id in (select auth_season_ids()) and (select auth_can_write()));

drop policy if exists "payments: team read" on player_payments;
drop policy if exists "payments: coach/manager write" on player_payments;
create policy "player_payments: season read" on player_payments for select
  using (season_id in (select auth_season_ids()));
create policy "player_payments: season write" on player_payments for all
  using (season_id in (select auth_season_ids()) and (select auth_can_write()))
  with check (season_id in (select auth_season_ids()) and (select auth_can_write()));

drop policy if exists "budget_transactions: team read" on budget_transactions;
drop policy if exists "budget_transactions: coach/manager write" on budget_transactions;
create policy "budget_transactions: season read" on budget_transactions for select
  using (season_id in (select auth_season_ids())
         or (season_id is null and organization_id = (select auth_organization_id())));
create policy "budget_transactions: season write" on budget_transactions for all
  using ((season_id in (select auth_season_ids())
          or (season_id is null and organization_id = (select auth_organization_id())))
         and (select auth_can_write()))
  with check ((season_id in (select auth_season_ids())
               or (season_id is null and organization_id = (select auth_organization_id())))
              and (select auth_can_write()));

drop policy if exists "budget_items: team read" on budget_items;
drop policy if exists "budget_items: coach/manager write" on budget_items;
create policy "budget_items: season read" on budget_items for select
  using (season_id in (select auth_season_ids())
         or (season_id is null and organization_id = (select auth_organization_id())));
create policy "budget_items: season write" on budget_items for all
  using ((season_id in (select auth_season_ids())
          or (season_id is null and organization_id = (select auth_organization_id())))
         and (select auth_can_write()))
  with check ((season_id in (select auth_season_ids())
               or (season_id is null and organization_id = (select auth_organization_id())))
              and (select auth_can_write()));

drop policy if exists "documents: team read" on documents;
drop policy if exists "documents: coach/manager write" on documents;
create policy "documents: season read" on documents for select
  using (season_id in (select auth_season_ids())
         or (season_id is null and organization_id = (select auth_organization_id())));
create policy "documents: season write" on documents for all
  using ((season_id in (select auth_season_ids())
          or (season_id is null and organization_id = (select auth_organization_id())))
         and (select auth_can_write()))
  with check ((season_id in (select auth_season_ids())
               or (season_id is null and organization_id = (select auth_organization_id())))
              and (select auth_can_write()));

-- payment_log has no direct scope column; inherits through its payment.
drop policy if exists "payment_log: team read" on payment_log;
drop policy if exists "payment_log: coach/manager write" on payment_log;
create policy "payment_log: season read" on payment_log for select
  using (payment_id in (select id from player_payments
                        where season_id in (select auth_season_ids())));
create policy "payment_log: season write" on payment_log for all
  using (payment_id in (select id from player_payments
                        where season_id in (select auth_season_ids()))
         and (select auth_can_write()))
  with check (payment_id in (select id from player_payments
                             where season_id in (select auth_season_ids()))
              and (select auth_can_write()));

-- ============ TEAM-SCOPED TABLES ============

drop policy if exists "seasons: org read" on seasons;
drop policy if exists "seasons: org coach/manager write" on seasons;
create policy "seasons: team read" on seasons for select
  using (team_id in (select auth_team_ids()));
create policy "seasons: team write" on seasons for all
  using (team_id in (select auth_team_ids()) and (select auth_can_write()))
  with check (team_id in (select auth_team_ids()) and (select auth_can_write()));

drop policy if exists "team_season_players: org read" on team_season_players;
drop policy if exists "team_season_players: org coach/manager write" on team_season_players;
create policy "team_season_players: team read" on team_season_players for select
  using (team_id in (select auth_team_ids()));
create policy "team_season_players: team write" on team_season_players for all
  using (team_id in (select auth_team_ids()) and (select auth_can_write()))
  with check (team_id in (select auth_team_ids()) and (select auth_can_write()));

drop policy if exists "teams: org read" on teams;
drop policy if exists "teams: org coach/manager write" on teams;
create policy "teams: accessible read" on teams for select
  using (id in (select auth_team_ids()));
create policy "teams: admin write" on teams for all
  using (organization_id = (select auth_organization_id()) and (select auth_is_org_admin()))
  with check (organization_id = (select auth_organization_id()) and (select auth_is_org_admin()));

drop policy if exists "team_memberships: org read" on team_memberships;
drop policy if exists "team_memberships: org coach/manager write" on team_memberships;
create policy "team_memberships: own or admin read" on team_memberships for select
  using (profile_id = auth.uid()
         or (team_id in (select id from teams
                         where organization_id = (select auth_organization_id()))
             and (select auth_is_org_admin())));
create policy "team_memberships: admin write" on team_memberships for all
  using (team_id in (select id from teams
                     where organization_id = (select auth_organization_id()))
         and (select auth_is_org_admin()))
  with check (team_id in (select id from teams
                          where organization_id = (select auth_organization_id()))
              and (select auth_is_org_admin()));

-- ============ ORGANIZATION-SCOPED (unchanged scope, write rules tightened) ============

drop policy if exists "players: org read" on players;
drop policy if exists "players: org coach/manager write" on players;
create policy "players: org read" on players for select
  using (organization_id = (select auth_organization_id()));
create policy "players: org write" on players for all
  using (organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (organization_id = (select auth_organization_id()) and (select auth_can_write()));

drop policy if exists "player_stats: team read" on player_stats;
drop policy if exists "player_stats: coach/manager write" on player_stats;
create policy "player_stats: org read" on player_stats for select
  using (organization_id = (select auth_organization_id()));
create policy "player_stats: org write" on player_stats for all
  using (organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (organization_id = (select auth_organization_id()) and (select auth_can_write()));

drop policy if exists "organizations: coach/manager update own" on organizations;
create policy "organizations: admin update own" on organizations for update
  using (id = (select auth_organization_id()) and (select auth_is_org_admin()))
  with check (id = (select auth_organization_id()) and (select auth_is_org_admin()));

drop policy if exists "invites: team coach/manager manage" on invites;
create policy "invites: admin manage" on invites for all
  using (organization_id = (select auth_organization_id()) and (select auth_is_org_admin()))
  with check (organization_id = (select auth_organization_id()) and (select auth_is_org_admin()));

-- ============ SHARED REFERENCE ENTITIES (write rules tightened only) ============

drop policy if exists "facilities: any coach/manager can create" on facilities;
drop policy if exists "facilities: creating org can modify own" on facilities;
drop policy if exists "facilities: creating org can delete own" on facilities;
create policy "facilities: authenticated create" on facilities for insert
  with check ((select auth_can_write())
              and created_by_organization_id = (select auth_organization_id()));
create policy "facilities: creating org modify" on facilities for update
  using (created_by_organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (created_by_organization_id = (select auth_organization_id()) and (select auth_can_write()));
create policy "facilities: creating org delete" on facilities for delete
  using (created_by_organization_id = (select auth_organization_id()) and (select auth_can_write()));

drop policy if exists "tournament_providers: any coach/manager can create" on tournament_providers;
drop policy if exists "tournament_providers: creating org can modify own" on tournament_providers;
drop policy if exists "tournament_providers: creating org can delete own" on tournament_providers;
create policy "tournament_providers: authenticated create" on tournament_providers for insert
  with check ((select auth_can_write())
              and created_by_organization_id = (select auth_organization_id()));
create policy "tournament_providers: creating org modify" on tournament_providers for update
  using (created_by_organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (created_by_organization_id = (select auth_organization_id()) and (select auth_can_write()));
create policy "tournament_providers: creating org delete" on tournament_providers for delete
  using (created_by_organization_id = (select auth_organization_id()) and (select auth_can_write()));
