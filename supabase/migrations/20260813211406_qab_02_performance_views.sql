-- qab_02_performance_views
--
-- Every aggregate is derived from plate_appearances at query time. There is
-- no stored counter anywhere, so PA, QAB, and QAB% cannot drift from the
-- underlying records.
--
-- SECURITY_INVOKER IS MANDATORY ON EVERY VIEW HERE.
-- Without it a view executes with the definer's privileges and silently
-- bypasses RLS, exposing every organization's data to every user. There is
-- no error and no symptom. Verify after applying:
--
--   select relname, reloptions from pg_class
--    where relkind = 'v' and relname like 'qab_%';
--
-- Each must show {security_invoker=true}.

create view public.qab_player_season with (security_invoker = true) as
  select
    pa.organization_id,
    pa.season_id,
    pa.player_id,
    count(*)                                as plate_appearances,
    count(*) filter (where pa.is_qab)       as qab,
    round(100.0 * count(*) filter (where pa.is_qab) / nullif(count(*), 0), 1) as qab_pct
  from public.plate_appearances pa
  where pa.voided_at is null
  group by pa.organization_id, pa.season_id, pa.player_id;

create view public.qab_player_tournament with (security_invoker = true) as
  select
    pa.organization_id,
    pa.season_id,
    g.tournament_id,
    pa.player_id,
    count(*)                                as plate_appearances,
    count(*) filter (where pa.is_qab)       as qab,
    round(100.0 * count(*) filter (where pa.is_qab) / nullif(count(*), 0), 1) as qab_pct
  from public.plate_appearances pa
  join public.games g on g.id = pa.game_id
  where pa.voided_at is null
    and g.tournament_id is not null
  group by pa.organization_id, pa.season_id, g.tournament_id, pa.player_id;

create view public.qab_team_tournament with (security_invoker = true) as
  select
    pa.organization_id,
    pa.season_id,
    g.tournament_id,
    count(*)                                as plate_appearances,
    count(*) filter (where pa.is_qab)       as qab,
    round(100.0 * count(*) filter (where pa.is_qab) / nullif(count(*), 0), 1) as qab_pct,
    count(distinct pa.player_id)            as players
  from public.plate_appearances pa
  join public.games g on g.id = pa.game_id
  where pa.voided_at is null
    and g.tournament_id is not null
  group by pa.organization_id, pa.season_id, g.tournament_id;

-- Reason trends. One plate appearance with three reasons contributes to three
-- reason rows but only one QAB — which is exactly why the aggregate views
-- above never sum these counts to derive QAB.
create view public.qab_reason_tournament with (security_invoker = true) as
  select
    pa.organization_id,
    pa.season_id,
    g.tournament_id,
    r.reason,
    count(*) as occurrences
  from public.plate_appearances pa
  join public.games g on g.id = pa.game_id
  cross join lateral unnest(pa.qab_reasons) as r(reason)
  where pa.voided_at is null
    and g.tournament_id is not null
  group by pa.organization_id, pa.season_id, g.tournament_id, r.reason;
