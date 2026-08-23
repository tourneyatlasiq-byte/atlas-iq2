-- Seasons are organizational structure, not operational data.
--
-- The policy used auth_can_write(), so a coach could rename the season, create
-- seasons, and flip is_current — which changes what every user on that team
-- sees, because all scoping resolves through the current season. Teams already
-- required auth_is_org_admin(); seasons now match.
--
-- Reads are unchanged: everyone on the team still sees every season.

drop policy if exists "seasons: team write" on seasons;

create policy "seasons: admin write" on seasons for all
  using (
    team_id in (select auth_team_ids())
    and (select auth_is_org_admin())
  )
  with check (
    team_id in (select auth_team_ids())
    and (select auth_is_org_admin())
  );
