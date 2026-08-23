-- #168: staff behaviour unchanged; parents restricted to linked players.
-- coalesce guards the null-role case so an unknown role denies rather than passes.

drop policy if exists "players: org read" on public.players;
create policy "players: org read" on public.players for select using (
  organization_id = (select auth_organization_id())
  and (coalesce((select auth_org_role()),'') <> 'parent'
       or id in (select auth_linked_player_ids()))
);

-- #177: split the ALL policy so DELETE has no policy at all.
drop policy if exists "players: org write" on public.players;
create policy "players: org insert" on public.players for insert
  with check (organization_id = (select auth_organization_id()) and (select auth_can_write()));
create policy "players: org update" on public.players for update
  using (organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (organization_id = (select auth_organization_id()) and (select auth_can_write()));

drop policy if exists "player_payments: season read" on public.player_payments;
create policy "player_payments: season read" on public.player_payments for select using (
  season_id in (select auth_season_ids())
  and (coalesce((select auth_org_role()),'') <> 'parent'
       or player_id in (select auth_linked_player_ids()))
);

drop policy if exists "payment_log: season read" on public.payment_log;
create policy "payment_log: season read" on public.payment_log for select using (
  payment_id in (
    select pp.id from player_payments pp
    where pp.season_id in (select auth_season_ids())
      and (coalesce((select auth_org_role()),'') <> 'parent'
           or pp.player_id in (select auth_linked_player_ids()))
  )
);

drop policy if exists "documents: season read" on public.documents;
create policy "documents: season read" on public.documents for select using (
  ((season_id in (select auth_season_ids()))
   or (season_id is null and organization_id = (select auth_organization_id())))
  and ((category <> 'Birth Certificate') or (select auth_is_org_admin()))
  and (coalesce((select auth_org_role()),'') <> 'parent'
       or player_id in (select auth_linked_player_ids()))
);

drop policy if exists "player_stats: org read" on public.player_stats;
create policy "player_stats: org read" on public.player_stats for select using (
  organization_id = (select auth_organization_id())
  and (coalesce((select auth_org_role()),'') <> 'parent'
       or player_id in (select auth_linked_player_ids()))
);

drop policy if exists "college_interests: org read" on public.player_college_interests;
create policy "college_interests: org read" on public.player_college_interests for select using (
  organization_id = (select auth_organization_id())
  and (coalesce((select auth_org_role()),'') <> 'parent'
       or player_id in (select auth_linked_player_ids()))
);

drop policy if exists "team_season_players: team read" on public.team_season_players;
create policy "team_season_players: team read" on public.team_season_players for select using (
  team_id in (select auth_team_ids())
  and (coalesce((select auth_org_role()),'') <> 'parent'
       or player_id in (select auth_linked_player_ids()))
);

drop policy if exists "participants: season read" on public.tournament_participants;
create policy "participants: season read" on public.tournament_participants for select using (
  season_id in (select auth_season_ids())
  and (coalesce((select auth_org_role()),'') <> 'parent'
       or player_id in (select auth_linked_player_ids()))
);

-- Internal financial and contact data: staff only.
drop policy if exists "budget_items: season read" on public.budget_items;
create policy "budget_items: season read" on public.budget_items for select using (
  ((season_id in (select auth_season_ids()))
   or (season_id is null and organization_id = (select auth_organization_id())))
  and coalesce((select auth_org_role()),'') <> 'parent'
);

drop policy if exists "budget_transactions: season read" on public.budget_transactions;
create policy "budget_transactions: season read" on public.budget_transactions for select using (
  ((season_id in (select auth_season_ids()))
   or (season_id is null and organization_id = (select auth_organization_id())))
  and coalesce((select auth_org_role()),'') <> 'parent'
);

drop policy if exists "contacts: org read" on public.contacts;
create policy "contacts: org read" on public.contacts for select using (
  organization_id = (select auth_organization_id())
  and coalesce((select auth_org_role()),'') <> 'parent'
);
