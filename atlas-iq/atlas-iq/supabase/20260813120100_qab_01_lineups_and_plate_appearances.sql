-- qab_01_lineups_and_plate_appearances
--
-- Quality At Bat core schema. Additive: two new tables, four new functions,
-- five new triggers, four new policies. Nothing existing is altered.
--
-- Scoping follows the established convention — season_id, never a redundant
-- team_id. A season belongs to exactly one team, so season scoping implies
-- team scoping (see lib/context.js).

-- ---------------------------------------------------------------------------
-- Batting order
-- ---------------------------------------------------------------------------

create table public.game_lineup_slots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id       uuid not null references public.seasons(id),
  game_id         uuid not null references public.games(id) on delete cascade,
  -- CASCADE: a lineup slot with no plate appearances behind it records no
  -- measurement. RESTRICT here would make any player who was ever written
  -- into a lineup permanently undeletable, which is a false positive.
  -- plate_appearances.player_id carries the RESTRICT that protects history.
  player_id       uuid not null references public.players(id) on delete cascade,
  batting_order   smallint not null check (batting_order between 1 and 40),
  created_at      timestamptz not null default now(),
  unique (game_id, batting_order),
  unique (game_id, player_id)
);

create index idx_lineup_slots_game   on public.game_lineup_slots (game_id);
create index idx_lineup_slots_season on public.game_lineup_slots (season_id);

-- ---------------------------------------------------------------------------
-- Plate appearances — one row per plate appearance, no counters anywhere
-- ---------------------------------------------------------------------------

create table public.plate_appearances (
  -- No default, deliberately. The client generates this UUID at tap time so
  -- the record has an identity before the network does, which is what makes
  -- `on conflict (id) do nothing` a safe retry.
  id              uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id       uuid not null references public.seasons(id),
  game_id         uuid not null references public.games(id) on delete cascade,
  -- RESTRICT: recorded performance is history and must never vanish because
  -- someone deleted a player. Archive is the intended path.
  player_id       uuid not null references public.players(id) on delete restrict,
  -- Per player, per game: this player's first plate appearance is 1.
  pa_number       smallint not null check (pa_number between 1 and 20),
  inning          smallint check (inning between 1 and 30),
  qab_reasons     text[] not null default '{}',
  -- Enforced by the database, not by application code: several reasons on one
  -- plate appearance still count as exactly one quality at bat.
  is_qab          boolean generated always as (cardinality(qab_reasons) > 0) stored,
  notes           text,
  recorded_by     uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Undo is a soft void: correction history survives, counts exclude it.
  voided_at       timestamptz,
  voided_by       uuid references auth.users(id),
  constraint pa_reasons_allowed check (
    qab_reasons <@ array[
      'hit','walk','hbp','hard_hit','eight_pitch',
      'situation_success','sac_bunt','sac_fly'
    ]::text[]
  )
);

comment on column public.plate_appearances.qab_reasons is
  'Zero or more of the eight QAB reasons. Empty array = a recorded non-QAB plate appearance.';

-- Catches two devices recording the same slot for the same batter.
create unique index plate_appearances_natural_key
  on public.plate_appearances (game_id, player_id, pa_number)
  where voided_at is null;

create index idx_pa_game    on public.plate_appearances (game_id)   where voided_at is null;
create index idx_pa_season  on public.plate_appearances (season_id) where voided_at is null;
create index idx_pa_player  on public.plate_appearances (player_id) where voided_at is null;
create index idx_pa_reasons on public.plate_appearances using gin (qab_reasons);

-- ---------------------------------------------------------------------------
-- Normalisation
-- ---------------------------------------------------------------------------

-- A CHECK constraint cannot contain a subquery, so de-duplication and
-- canonical ordering happen here instead.
create function public.normalize_qab_reasons()
returns trigger
language plpgsql
as $$
begin
  new.qab_reasons := array(select distinct unnest(new.qab_reasons) order by 1);
  new.updated_at  := now();
  return new;
end;
$$;

create trigger trg_normalize_qab_reasons
  before insert or update on public.plate_appearances
  for each row execute function public.normalize_qab_reasons();

-- ---------------------------------------------------------------------------
-- Integrity — mirrors enforce_participant_integrity
-- ---------------------------------------------------------------------------

create function public.enforce_pa_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g_org uuid; g_season uuid; p_org uuid; p_type text;
begin
  select organization_id, season_id into g_org, g_season
    from games where id = new.game_id;

  if g_org is null then
    raise exception 'That game could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if new.season_id is distinct from g_season then
    raise exception 'The season does not match this game''s season.'
      using errcode = 'check_violation';
  end if;

  if new.organization_id is distinct from g_org then
    raise exception 'The organization does not match this game''s.'
      using errcode = 'check_violation';
  end if;

  select organization_id, person_type into p_org, p_type
    from players where id = new.player_id;

  if p_org is null then
    raise exception 'That player could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if p_org is distinct from g_org then
    raise exception 'That player belongs to a different organization.'
      using errcode = 'check_violation';
  end if;

  -- players.person_type is authoritative, shared with roster counts and the
  -- participant rules. Coaches and staff never bat.
  if p_type is distinct from 'player' then
    raise exception 'Only players can have plate appearances.'
      using errcode = 'check_violation';
  end if;

  if auth.uid() is not null then
    new.recorded_by := coalesce(new.recorded_by, auth.uid());
  end if;

  return new;
end;
$$;

create trigger pa_integrity
  before insert or update on public.plate_appearances
  for each row execute function public.enforce_pa_integrity();

-- Past-season locking, identical to games / tournaments / participants.
create trigger season_write_policy
  before insert or update or delete on public.plate_appearances
  for each row execute function public.enforce_season_write_policy('season_id');

create trigger season_write_policy
  before insert or update or delete on public.game_lineup_slots
  for each row execute function public.enforce_season_write_policy('season_id');

-- ---------------------------------------------------------------------------
-- Copy previous lineup — explicit user action only, never automatic
-- ---------------------------------------------------------------------------

create function public.copy_previous_lineup(p_game_id uuid)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_season uuid; v_org uuid; v_date date; v_src uuid; v_count int;
begin
  select season_id, organization_id, game_date
    into v_season, v_org, v_date
    from games where id = p_game_id;

  if v_season is null then
    raise exception 'That game could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if exists (select 1 from game_lineup_slots where game_id = p_game_id) then
    raise exception 'This game already has a lineup. Clear it before copying.'
      using errcode = 'check_violation';
  end if;

  -- Most recent earlier game in the same season that actually has a lineup.
  -- The tuple comparison keeps same-day games deterministic.
  select g.id into v_src
    from games g
   where g.season_id = v_season
     and g.id <> p_game_id
     and exists (select 1 from game_lineup_slots s where s.game_id = g.id)
     and (g.game_date, g.id::text) < (v_date, p_game_id::text)
   order by g.game_date desc, g.id desc
   limit 1;

  if v_src is null then
    return 0;
  end if;

  -- Archived players are not carried forward.
  insert into game_lineup_slots (organization_id, season_id, game_id, player_id, batting_order)
  select v_org, v_season, p_game_id, s.player_id, s.batting_order
    from game_lineup_slots s
   where s.game_id = v_src
     and exists (
       select 1 from players p
        where p.id = s.player_id and p.archived_at is null
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.copy_previous_lineup(uuid) from public;
grant execute on function public.copy_previous_lineup(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS — same shape as games, plus the feature gate
-- ---------------------------------------------------------------------------

alter table public.game_lineup_slots enable row level security;
alter table public.plate_appearances enable row level security;

-- The feature gate lives here, not only in the UI. An organization without
-- the flag receives zero rows regardless of what any client sends.

create policy "game_lineup_slots: season read"
  on public.game_lineup_slots
  for select
  using (
        (select public.auth_org_has_feature('qab'))
    and season_id in (select public.auth_season_ids())
    and ( coalesce((select public.auth_org_role()), '') <> 'parent'
          or player_id in (select public.auth_linked_player_ids()) )
  );

create policy "game_lineup_slots: season write"
  on public.game_lineup_slots
  for all
  using (
        (select public.auth_org_has_feature('qab'))
    and season_id in (select public.auth_season_ids())
    and (select public.auth_can_write())
  )
  with check (
        (select public.auth_org_has_feature('qab'))
    and season_id in (select public.auth_season_ids())
    and (select public.auth_can_write())
  );

create policy "plate_appearances: season read"
  on public.plate_appearances
  for select
  using (
        (select public.auth_org_has_feature('qab'))
    and season_id in (select public.auth_season_ids())
    and ( coalesce((select public.auth_org_role()), '') <> 'parent'
          or player_id in (select public.auth_linked_player_ids()) )
  );

create policy "plate_appearances: season write"
  on public.plate_appearances
  for all
  using (
        (select public.auth_org_has_feature('qab'))
    and season_id in (select public.auth_season_ids())
    and (select public.auth_can_write())
  )
  with check (
        (select public.auth_org_has_feature('qab'))
    and season_id in (select public.auth_season_ids())
    and (select public.auth_can_write())
  );
