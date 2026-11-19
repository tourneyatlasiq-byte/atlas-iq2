-- Lineup in-game integrity (lineup_in_game_integrity).
-- Applied BEFORE the app deploy: the app saves and copies lineups through
-- replace_game_lineup() and has no fallback to the old two-step write.
--
-- DEPLOY ORDER: this migration first, then the app. The new app
-- saves and copies lineups through replace_game_lineup() and has no fallback to
-- the old two-step write (that fallback is the bug being removed).
--
-- WHAT THIS DOES
--   1. Atomic Save and Copy: replace_game_lineup() replaces a game's batting
--      order in one transaction. A failure leaves the previous lineup intact.
--   2. In-game rule, enforced by the DATABASE on the lineup table itself, so it
--      holds for the app, a stale tab, a double tap or a hand-written request:
--      once a game has a recorded (non-voided) plate appearance,
--        - no slot can be deleted,
--        - no slot can change its batting_order,
--        - a new slot can only be added at the end (max + 1),
--        - the player in a slot CAN change (that is Substitute, and it keeps
--          every recorded at-bat with the player who batted).
--      Before the first at-bat nothing is restricted.
--   3. One per-game lock shared by lineup writes and plate appearance writes,
--      so "an at-bat is being recorded while the lineup is being saved" is
--      always decided in one order, never both passing the check.
--
-- SECURITY
--   * replace_game_lineup is SECURITY INVOKER. The QAB feature gate, season
--     scope, coach/owner write rule, finished-season trigger and the UNIQUE
--     constraints apply exactly as to a direct write. Player eligibility stays
--     in the application layer, as today.
--   * guard_lineup_slots is SECURITY DEFINER only so it can see plate
--     appearances regardless of the caller's read policy (a parent-scoped read
--     would otherwise hide them). Because it runs with the owner's rights it is
--     hardened: `set search_path = ''` (so a caller's temporary table or
--     search_path cannot redirect any name), every table and function is
--     schema-qualified, and it is not executable by anyone directly. Trigger
--     functions need no EXECUTE grant to fire.
--   * All three functions use an empty search_path with qualified names, and
--     none is callable by anon or public. Only replace_game_lineup is granted,
--     to authenticated. The per-game lock is taken inline (no separate helper
--     function), so nothing lets a caller take an arbitrary advisory lock.
--
-- PLATE APPEARANCES ARE NEVER REJECTED BY THIS. The lock trigger on
-- plate_appearances only waits its turn. An at-bat recorded mid-game must never
-- be refused because of a lineup change (see lib/actions/plate-appearances.js).
--
-- Additive: three functions, two triggers on game_lineup_slots and
-- plate_appearances. No table, column, policy or data changes.

-- ---------------------------------------------------------------------------
-- Plate appearances: take the game's lock, nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.pa_lineup_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lineup:' || new.game_id::text, 0));
  return new;
end;
$$;

drop trigger if exists pa_lineup_lock on public.plate_appearances;
create trigger pa_lineup_lock
  before insert or update of voided_at on public.plate_appearances
  for each row execute function public.pa_lineup_lock();

-- ---------------------------------------------------------------------------
-- Lineup slots: the in-game rule.
-- ---------------------------------------------------------------------------
create or replace function public.guard_lineup_slots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game uuid := coalesce(new.game_id, old.game_id);
  v_tracked boolean;
  v_max smallint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lineup:' || v_game::text, 0));

  select exists (
    select 1 from public.plate_appearances where game_id = v_game and voided_at is null
  ) into v_tracked;

  if not v_tracked then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    -- A cascade (the game or organization being deleted) is not a lineup edit.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'This game is already being tracked, so batters can''t be removed from its batting order. Substitute a player instead.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.game_id is distinct from old.game_id
       or new.batting_order is distinct from old.batting_order then
      raise exception 'This game is already being tracked, so batting positions can''t be changed. Substitute a player instead.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- INSERT: late arrivals only, at the end.
  select coalesce(pg_catalog.max(batting_order), 0) into v_max from public.game_lineup_slots where game_id = v_game;
  if new.batting_order is distinct from v_max + 1 then
    raise exception 'This game is already being tracked. A late batter can only be added at the end of the batting order.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_lineup_slots on public.game_lineup_slots;
create trigger guard_lineup_slots
  before insert or update or delete on public.game_lineup_slots
  for each row execute function public.guard_lineup_slots();

-- ---------------------------------------------------------------------------
-- Atomic replace, used by Save lineup and Copy lineup.
-- ---------------------------------------------------------------------------
create or replace function public.replace_game_lineup(p_game_id uuid, p_player_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org     uuid;
  v_season  uuid;
  v_new     uuid[] := coalesce(p_player_ids, '{}'::uuid[]);
  v_old     uuid[];
  v_tracked boolean;
begin
  select organization_id, season_id into v_org, v_season from public.games where id = p_game_id;
  if v_org is null then
    raise exception 'That game could not be found.' using errcode = 'foreign_key_violation';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lineup:' || p_game_id::text, 0));

  if exists (select 1 from pg_catalog.unnest(v_new) as x group by x having count(*) > 1) then
    raise exception 'A player appears twice in that order. Remove the duplicate.'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from public.plate_appearances where game_id = p_game_id and voided_at is null
  ) into v_tracked;

  if v_tracked then
    -- Tracked game: the existing order is fixed. The request must be the
    -- current order, optionally followed by late arrivals. Only the late
    -- arrivals are inserted; existing rows are never deleted or rewritten.
    select coalesce(pg_catalog.array_agg(player_id order by batting_order), '{}'::uuid[]) into v_old
      from public.game_lineup_slots where game_id = p_game_id;

    if pg_catalog.cardinality(v_new) < pg_catalog.cardinality(v_old)
       or v_new[1:pg_catalog.cardinality(v_old)] is distinct from v_old then
      raise exception 'This game is already being tracked. The batting order can''t be reordered, shortened or cleared. You can add late batters at the end or substitute a player. If the page is out of date, reload it.'
        using errcode = 'check_violation';
    end if;

    insert into public.game_lineup_slots (organization_id, season_id, game_id, player_id, batting_order)
    select v_org, v_season, p_game_id, t.pid, t.ord::smallint
      from pg_catalog.unnest(v_new) with ordinality as t(pid, ord)
     where t.ord > pg_catalog.cardinality(v_old);

    return pg_catalog.cardinality(v_new);
  end if;

  delete from public.game_lineup_slots where game_id = p_game_id;

  insert into public.game_lineup_slots (organization_id, season_id, game_id, player_id, batting_order)
  select v_org, v_season, p_game_id, t.pid, t.ord::smallint
    from pg_catalog.unnest(v_new) with ordinality as t(pid, ord);

  return pg_catalog.cardinality(v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions. Supabase grants new functions to anon and authenticated by
-- default, so take those away explicitly, then grant only what is needed.
-- ---------------------------------------------------------------------------
revoke all on function public.pa_lineup_lock()    from public, anon, authenticated;
revoke all on function public.guard_lineup_slots() from public, anon, authenticated;
revoke all on function public.replace_game_lineup(uuid, uuid[]) from public, anon;
grant execute on function public.replace_game_lineup(uuid, uuid[]) to authenticated;
