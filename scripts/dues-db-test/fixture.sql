-- Scratch-database fixture for the dues schedule database tests.
--
-- NOT part of the application. Recreates just enough of production to run the
-- migration: the table layouts of the tables it touches, and the REAL
-- record_player_payment / undo_player_payment / player_payment_fingerprint
-- definitions (copied from production 2026-11-23, read only).
--
-- STUBS (labelled): auth_* helpers read the session settings app.org / app.role /
-- app.linked, instead of looking at Supabase's login. Real production behaviour of
-- those helpers is NOT exercised here; it is exercised only once the migration is applied.

drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; create schema auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

create table public.organizations (id uuid primary key default gen_random_uuid(), name text);
create table public.seasons (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text);
create table public.players (id uuid primary key default gen_random_uuid(), name text);

-- STUBS
create function public.auth_organization_id() returns uuid language sql stable security definer set search_path = public as $$ select nullif(current_setting('app.org', true), '')::uuid $$;
create function public.auth_season_ids() returns setof uuid language sql stable security definer set search_path = public as $$ select id from public.seasons where organization_id = public.auth_organization_id() $$;
create function public.auth_org_role() returns text language sql stable security definer set search_path = public as $$ select nullif(current_setting('app.role', true), '') $$;
create function public.auth_can_write() returns boolean language sql stable security definer set search_path = public as $$ select coalesce(public.auth_org_role() in ('owner','admin','coach','manager'), false) $$;
create function public.auth_linked_player_ids() returns setof uuid language sql stable security definer set search_path = public as $$ select x::uuid from unnest(string_to_array(nullif(current_setting('app.linked', true), ''), ',')) x $$;

-- Production table layouts
create table public.player_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  player_name text,
  initial_cost numeric(10,2) not null default 0,
  season_id uuid references public.seasons(id),
  exempt boolean not null default false,
  constraint player_payments_exempt_zero check (not exempt or initial_cost = 0)
);
create table public.payment_log (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.player_payments(id) on delete restrict,
  month_label text,
  amount numeric(10,2) not null,
  paid_date date default current_date,
  request_key uuid
);
create table public.player_payment_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null references public.seasons(id),
  payment_id uuid not null references public.player_payments(id) on delete cascade,
  request_key uuid not null unique,
  entry_id uuid not null,
  amount numeric not null,
  after_fingerprint text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
alter table public.player_payments enable row level security;
alter table public.payment_log enable row level security;
alter table public.player_payment_operations enable row level security;
create policy "player_payments: season read" on public.player_payments for select using (season_id in (select auth_season_ids()) and (coalesce((select auth_org_role()), '') <> 'parent' or player_id in (select auth_linked_player_ids())));
create policy "player_payments: season write" on public.player_payments for all using (season_id in (select auth_season_ids()) and (select auth_can_write())) with check (season_id in (select auth_season_ids()) and (select auth_can_write()));
create policy "payment_log: season read" on public.payment_log for select using (payment_id in (select pp.id from public.player_payments pp where pp.season_id in (select auth_season_ids()) and (coalesce((select auth_org_role()), '') <> 'parent' or pp.player_id in (select auth_linked_player_ids()))));
create policy "payment_log: season write" on public.payment_log for all using (payment_id in (select id from public.player_payments where season_id in (select auth_season_ids())) and (select auth_can_write())) with check (payment_id in (select id from public.player_payments where season_id in (select auth_season_ids())) and (select auth_can_write()));
grant select, insert, update, delete on public.player_payments, public.payment_log to anon, authenticated;
grant select on public.player_payment_operations to authenticated;
grant select on public.organizations, public.seasons, public.players to authenticated;

-- REAL production definitions
CREATE OR REPLACE FUNCTION public.player_payment_fingerprint(p_payment_id uuid)
 RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  select md5(
    coalesce((select concat_ws('|', round(initial_cost, 2)::text, exempt::text)
                from public.player_payments where id = p_payment_id), '')
    || '#' ||
    coalesce((select string_agg(
                concat_ws('|', id::text, round(amount, 2)::text, coalesce(paid_date::text, ''), coalesce(month_label, '')),
                ';' order by id)
              from public.payment_log where payment_id = p_payment_id), '')
  );
$function$;

CREATE OR REPLACE FUNCTION public.record_player_payment(p_payment_id uuid, p_request_key uuid, p_expected_paid numeric, p_amount numeric, p_date date DEFAULT NULL::date, p_month_label text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  pp       record;
  pre      record;
  prior    record;
  cur_paid numeric;
  cur_cnt  int;
  v_id     uuid;
  v_op     uuid := gen_random_uuid();
begin
  if p_request_key is null then
    raise exception 'A request key is required.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'message', 'Enter an amount.');
  end if;
  select season_id, organization_id into pre from public.player_payments where id = p_payment_id;
  if not found
     or not (pre.season_id in (select auth_season_ids()))
     or pre.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Set what this player owes before recording a payment.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change payments.');
  end if;
  select id, organization_id, season_id into pp
    from public.player_payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found',
      'message', 'Set what this player owes before recording a payment.');
  end if;
  if not (pp.season_id in (select auth_season_ids())) or pp.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found',
      'message', 'Set what this player owes before recording a payment.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden',
      'message', 'You do not have permission to change payments.');
  end if;
  select o.id as op_id, o.payment_id, o.entry_id, o.undone_at into prior
    from public.player_payment_operations o where o.request_key = p_request_key;
  if found then
    if prior.payment_id is distinct from p_payment_id then
      return jsonb_build_object('ok', false, 'code', 'key_reused',
        'message', 'That request key was already used for a different payment.');
    end if;
    select count(*), coalesce(sum(amount), 0) into cur_cnt, cur_paid
      from public.payment_log where payment_id = p_payment_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', prior.entry_id,
      'operation_id', prior.op_id, 'undone', prior.undone_at is not null,
      'paid', cur_paid, 'entry_count', cur_cnt);
  end if;
  select id, payment_id into prior from public.payment_log where request_key = p_request_key;
  if found then
    return jsonb_build_object('ok', false, 'code', 'key_reused',
      'message', 'That request key was already used.');
  end if;
  select count(*), coalesce(sum(amount), 0) into cur_cnt, cur_paid
    from public.payment_log where payment_id = p_payment_id;
  if p_expected_paid is not null and round(cur_paid, 2) is distinct from round(p_expected_paid, 2) then
    return jsonb_build_object('ok', false, 'code', 'changed',
      'message', 'A payment was recorded while you were looking at this. Nothing was saved.',
      'paid', cur_paid, 'entry_count', cur_cnt);
  end if;
  insert into public.payment_log (payment_id, amount, paid_date, month_label, request_key)
  values (p_payment_id, round(p_amount, 2), coalesce(p_date, current_date), p_month_label, p_request_key)
  returning id into v_id;
  insert into public.player_payment_operations
    (id, organization_id, season_id, payment_id, request_key, entry_id, amount, after_fingerprint)
  values
    (v_op, pp.organization_id, pp.season_id, p_payment_id, p_request_key, v_id, round(p_amount, 2),
     public.player_payment_fingerprint(p_payment_id));
  return jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id, 'operation_id', v_op,
    'paid', round(cur_paid + round(p_amount, 2), 2), 'entry_count', cur_cnt + 1);
end;
$function$;

CREATE OR REPLACE FUNCTION public.undo_player_payment(p_operation_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  op record;
  n  int;
begin
  select payment_id, season_id, organization_id into op from public.player_payment_operations where id = p_operation_id;
  if not found or not (op.season_id in (select auth_season_ids())) or op.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That payment could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change payments.');
  end if;
  perform 1 from public.player_payments where id = op.payment_id for update;
  select * into op from public.player_payment_operations where id = p_operation_id for update;
  if op.undone_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_undone', 'message', 'That payment was already undone.');
  end if;
  if public.player_payment_fingerprint(op.payment_id) is distinct from op.after_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'changed_since',
      'message', 'This player''s dues or payments changed after that payment was saved, so it can''t be undone automatically. Nothing was changed.');
  end if;
  delete from public.payment_log where id = op.entry_id and payment_id = op.payment_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Could not remove the payment.' using errcode = '42501'; end if;
  update public.player_payment_operations set undone_at = now() where id = op.id;
  return jsonb_build_object('ok', true, 'payment_id', op.payment_id);
end;
$function$;
revoke all on function public.record_player_payment(uuid, uuid, numeric, numeric, date, text), public.undo_player_payment(uuid) from public, anon;
grant execute on function public.record_player_payment(uuid, uuid, numeric, numeric, date, text), public.undo_player_payment(uuid) to authenticated;
