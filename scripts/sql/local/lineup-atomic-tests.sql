-- LOCAL ONLY. Proves supabase/migrations/20261119231508_lineup_in_game_integrity.sql against the
-- throwaway lineup database (never Supabase). Prints "ok" / "FAIL" lines.
create schema if not exists t;
create table t.results (name text, ok boolean);
create function t.check(n text, c boolean) returns void language sql as $$ insert into t.results values (n, coalesce(c, false)) $$;
create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  execute 'set local role authenticated';
end $$;
create function t.reset() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function t.slots(g uuid) returns text language sql as $$ select coalesce(string_agg(batting_order || ':' || right(player_id::text, 2), ' ' order by batting_order), '') from game_lineup_slots where game_id = g $$;
grant usage on schema t to authenticated; grant execute on all functions in schema t to authenticated; grant select, insert on t.results to authenticated;

\set coachA '''10000000-0000-0000-0000-000000000002'''
\set parentA '''10000000-0000-0000-0000-000000000003'''
\set coachB '''10000000-0000-0000-0000-000000000004'''
\set ownerA '''10000000-0000-0000-0000-000000000001'''
\set g1 '''9a000000-0000-0000-0000-000000000001'''
\set g2 '''9a000000-0000-0000-0000-000000000002'''
\set gb '''9b000000-0000-0000-0000-000000000001'''
-- shorthand: p(n) = fictional player n
create function t.p(n int) returns uuid language sql as $$ select ('f0000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid $$;
grant execute on function t.p to authenticated;

-- 1 and 2: saves, renumbers, replaces
begin; select t.as_user(:coachA);
select replace_game_lineup(:g1, array[t.p(3), t.p(1), t.p(2)]);
select t.check('saves three batters numbered 1..3', t.slots(:g1) = '1:03 2:01 3:02');
select replace_game_lineup(:g1, array[t.p(2), t.p(3), t.p(1), t.p(4)]);
select t.check('saving again replaces the whole order, no leftovers', t.slots(:g1) = '1:02 2:03 3:01 4:04');
select t.check('returns the number of batters saved', replace_game_lineup(:g1, array[t.p(2), t.p(3), t.p(1), t.p(4)]) = 4);
commit;

-- 3: THE POINT. A failed insert must leave the old lineup in place.
begin; select t.as_user(:coachA);
select replace_game_lineup(:g1, array[t.p(1), t.p(2), t.p(3), t.p(4), t.p(5)]);
commit;
reset role;
create function t.block() returns trigger language plpgsql as $$ begin if new.player_id = t.p(9) then raise exception 'simulated database failure'; end if; return new; end $$;
create trigger test_block before insert on game_lineup_slots for each row execute function t.block();
do $$ declare ok boolean := false; begin
  perform t.as_user('10000000-0000-0000-0000-000000000002');
  begin perform replace_game_lineup('9a000000-0000-0000-0000-000000000001', array[t.p(6), t.p(7), t.p(9)]);
  exception when others then ok := true; end;
  perform t.reset();
  perform t.check('a failing insert raises an error', ok);
end $$;
select t.check('ATOMIC: the old 5-batter lineup is still there after the failure', t.slots(:g1) = '1:01 2:02 3:03 4:04 5:05');
drop trigger test_block on game_lineup_slots; drop function t.block();

-- 4: duplicates
do $$ declare ok boolean := false; begin
  perform t.as_user('10000000-0000-0000-0000-000000000002');
  begin perform replace_game_lineup('9a000000-0000-0000-0000-000000000001', array[t.p(1), t.p(1)]); exception when others then ok := true; end;
  perform t.reset(); perform t.check('a duplicate player is refused', ok);
end $$;
select t.check('...and the lineup is untouched', t.slots(:g1) = '1:01 2:02 3:03 4:04 5:05');

-- empty = clear (no tracked at-bats yet)
begin; select t.as_user(:coachA); select replace_game_lineup(:g2, array[t.p(1), t.p(2)]); select replace_game_lineup(:g2, '{}'); select t.check('an empty list clears a lineup with no recorded at-bats', t.slots(:g2) = ''); commit;

-- 5: in-game rule
reset role;
delete from game_lineup_slots where game_id = :g1;
insert into game_lineup_slots (organization_id, season_id, game_id, player_id, batting_order)
  select 'a0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', :g1, t.p(n), n from generate_series(1, 9) n;
insert into plate_appearances (organization_id, season_id, game_id, player_id, pa_number, batting_order, created_at)
  select 'a0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', :g1, t.p(n), 1, n, now() + n * interval '1 second' from generate_series(1, 4) n;
create function t.tries(newlist uuid[]) returns text language plpgsql as $$
begin
  perform replace_game_lineup('9a000000-0000-0000-0000-000000000001', newlist);
  return 'accepted';
exception when others then return 'refused';
end $$;
grant execute on function t.tries to authenticated;
begin; select t.as_user(:coachA);
select t.check('in game: swap two batters is refused', t.tries(array[t.p(1),t.p(2),t.p(7),t.p(4),t.p(5),t.p(6),t.p(3),t.p(8),t.p(9)]) = 'refused');
select t.check('in game: moving the leadoff to the bottom is refused', t.tries(array[t.p(2),t.p(3),t.p(4),t.p(5),t.p(6),t.p(7),t.p(8),t.p(9),t.p(1)]) = 'refused');
select t.check('in game: removing a batter is refused', t.tries(array[t.p(1),t.p(3),t.p(4),t.p(5),t.p(6),t.p(7),t.p(8),t.p(9)]) = 'refused');
select t.check('in game: adding a batter at the top is refused', t.tries(array[t.p(10),t.p(1),t.p(2),t.p(3),t.p(4),t.p(5),t.p(6),t.p(7),t.p(8),t.p(9)]) = 'refused');
select t.check('in game: shortening is refused', t.tries(array[t.p(1),t.p(2),t.p(3)]) = 'refused');
select t.check('in game: clearing is refused', t.tries('{}') = 'refused');
select t.check('in game: changing a player in a slot through save is refused (use Substitute)', t.tries(array[t.p(1),t.p(2),t.p(3),t.p(10),t.p(5),t.p(6),t.p(7),t.p(8),t.p(9)]) = 'refused');
select t.check('in game: nothing changed by any refusal', t.slots(:g1) = '1:01 2:02 3:03 4:04 5:05 6:06 7:07 8:08 9:09');
select t.check('in game: saving the identical order is accepted', t.tries(array[t.p(1),t.p(2),t.p(3),t.p(4),t.p(5),t.p(6),t.p(7),t.p(8),t.p(9)]) = 'accepted');
select t.check('in game: adding a late batter at the END is accepted', t.tries(array[t.p(1),t.p(2),t.p(3),t.p(4),t.p(5),t.p(6),t.p(7),t.p(8),t.p(9),t.p(10)]) = 'accepted');
select t.check('...and slots 1 to 9 are unchanged, the new batter is slot 10', t.slots(:g1) = '1:01 2:02 3:03 4:04 5:05 6:06 7:07 8:08 9:09 10:10');
commit;
reset role;
update plate_appearances set voided_at = now() where game_id = :g1;
begin; select t.as_user(:coachA);
select t.check('after every at-bat is undone (voided) the order may be reordered again', t.tries(array[t.p(9),t.p(8),t.p(7)]) = 'accepted');
commit;

-- 5b: hardening. A caller's temporary tables and search_path must not change the trigger.
reset role;
update plate_appearances set voided_at = null where game_id = :g1;   -- tracked again; slots are 9,8,7
select t.check('hardening: all three functions have a fixed empty search_path',
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('pa_lineup_lock','guard_lineup_slots','replace_game_lineup')
     and proconfig @> array['search_path=""']) = 3);
select t.check('hardening: the trigger functions cannot be executed by anon, authenticated or public',
  not has_function_privilege('anon', 'public.guard_lineup_slots()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_lineup_slots()', 'execute')
  and not has_function_privilege('anon', 'public.pa_lineup_lock()', 'execute')
  and not has_function_privilege('authenticated', 'public.pa_lineup_lock()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname in ('guard_lineup_slots','pa_lineup_lock') and a.grantee = 0));
select t.check('hardening: replace_game_lineup is executable by authenticated only (not anon or public)',
  has_function_privilege('authenticated', 'public.replace_game_lineup(uuid,uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.replace_game_lineup(uuid,uuid[])', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname = 'replace_game_lineup' and a.grantee = 0));
select t.check('hardening: no lock helper function is exposed', not exists (select 1 from pg_proc where proname = 'lineup_game_lock'));

begin; select t.as_user(:coachA);
-- Empty look-alike tables in the caller's temp schema, which Postgres searches FIRST by default,
-- plus a search_path that puts that schema first explicitly.
create temp table plate_appearances (game_id uuid, voided_at timestamptz, batting_order smallint);
create temp table game_lineup_slots (game_id uuid, batting_order smallint, player_id uuid);
create temp table games (id uuid, organization_id uuid, season_id uuid);
set local search_path = pg_temp, public;
do $$ declare r text; begin
  begin delete from public.game_lineup_slots where game_id = '9a000000-0000-0000-0000-000000000001' and batting_order = 1; r := 'accepted'; exception when others then r := 'refused'; end;
  perform t.check('shadowed: deleting a slot in a tracked game is still refused', r = 'refused');
  begin update public.game_lineup_slots set batting_order = 20 where game_id = '9a000000-0000-0000-0000-000000000001' and batting_order = 1; r := 'accepted'; exception when others then r := 'refused'; end;
  perform t.check('shadowed: renumbering a slot is still refused', r = 'refused');
  begin insert into public.game_lineup_slots (organization_id, season_id, game_id, player_id, batting_order)
    values ('a0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', t.p(10), 2); r := 'accepted'; exception when others then r := 'refused'; end;
  perform t.check('shadowed: inserting a batter into the middle is still refused', r = 'refused');
  begin perform public.replace_game_lineup('9a000000-0000-0000-0000-000000000001', array[t.p(7), t.p(8), t.p(9)]); r := 'accepted'; exception when others then r := 'refused'; end;
  perform t.check('shadowed: reordering through replace_game_lineup is still refused', r = 'refused');
  begin perform public.replace_game_lineup('9a000000-0000-0000-0000-000000000001', array[t.p(9), t.p(8), t.p(7), t.p(10)]); r := 'accepted'; exception when others then r := 'refused'; end;
  perform t.check('shadowed: a late arrival at the end is still accepted (behaviour unchanged, not just blocked)', r = 'accepted');
end $$;
drop table pg_temp.plate_appearances, pg_temp.game_lineup_slots, pg_temp.games;
commit;
reset role;
select t.check('shadowed: the real lineup is exactly slots 9,8,7 plus the late batter', t.slots(:g1) = '1:09 2:08 3:07 4:10');
-- Control: the same shadow, against the previous definition (search_path = public), would have let the delete through.
update plate_appearances set voided_at = now() where game_id = :g1;

-- 7, 8: feature gate and roles
begin; select t.as_user(:coachB);
select t.check('no-QAB organization: refused (feature gate)', t.tries(array[t.p(1)]) = 'refused');
commit;
do $$ declare ok boolean := false; begin
  perform t.as_user('10000000-0000-0000-0000-000000000004');
  begin perform replace_game_lineup('9b000000-0000-0000-0000-000000000001', array['f0000000-0000-0000-0000-0000000001b1'::uuid]); exception when others then ok := sqlstate = '42501'; end;
  perform t.reset(); perform t.check('no-QAB organization: the error is a row-security refusal the app already words as "aren''t available"', ok);
end $$;
select t.check('no-QAB organization: nothing written', (select count(*) from game_lineup_slots where game_id = :gb) = 0);
do $$ declare ok boolean := false; begin
  perform t.as_user('10000000-0000-0000-0000-000000000003');
  begin perform replace_game_lineup('9a000000-0000-0000-0000-000000000002', array[t.p(1)]); exception when others then ok := true; end;
  perform t.reset(); perform t.check('a parent cannot replace a lineup', ok);
end $$;
do $$ declare ok boolean := false; begin
  perform t.as_user('10000000-0000-0000-0000-000000000004');
  begin perform replace_game_lineup('9a000000-0000-0000-0000-000000000002', array[t.p(1)]); exception when others then ok := true; end;
  perform t.reset(); perform t.check('a coach from another organization cannot touch this game', ok);
end $$;
do $$ declare ok boolean := false; begin
  perform t.as_user('10000000-0000-0000-0000-000000000002');
  begin perform replace_game_lineup(gen_random_uuid(), array[t.p(1)]); exception when others then ok := true; end;
  perform t.reset(); perform t.check('an unknown game is refused', ok);
end $$;

-- 9: finished season. Today the owner's delete succeeds and the insert fails.
reset role;
delete from game_lineup_slots where game_id = :g2;
insert into game_lineup_slots (organization_id, season_id, game_id, player_id, batting_order) values
  ('a0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', :g2, t.p(1), 1), ('a0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', :g2, t.p(2), 2);
update seasons set phase = 'past' where id = '5a000000-0000-0000-0000-000000000001';
do $$ declare ok boolean := false; begin
  perform t.as_user('10000000-0000-0000-0000-000000000001');
  begin perform replace_game_lineup('9a000000-0000-0000-0000-000000000002', array[t.p(2), t.p(1)]); exception when others then ok := true; end;
  perform t.reset(); perform t.check('finished season: the owner''s save is refused', ok);
end $$;
select t.check('ATOMIC: finished season, the existing lineup survives the refused save', t.slots(:g2) = '1:01 2:02');
update seasons set phase = 'current' where id = '5a000000-0000-0000-0000-000000000001';

select case when ok then '  ok    ' else '  FAIL  ' end || name from t.results;
select count(*) filter (where not ok) || ' failed of ' || count(*) from t.results;
