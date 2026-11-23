-- Player dues schedules (2026-11).
--
-- WHAT THIS ADDS
--   dues_schedule_templates  the team's standard schedule: exact dates and dollar amounts
--   dues_installments        one row per scheduled payment for one player
--
--   Payments stay exactly where they are (payment_log). A schedule only says
--   WHEN the player's dues fall due; money is never attached to an installment,
--   so nothing can be counted twice. record_player_payment, undo_player_payment
--   and player_payment_fingerprint are NOT changed.
--
-- THE RULES THE DATABASE ENFORCES (not just the app)
--   1. Schedule total. A player with an active schedule must have installments
--      that add up to total dues exactly. Checked at COMMIT (deferred), so a
--      single save may change the total and the installments together, and a
--      change to only one of them is refused. This covers changes made by
--      dues_installments writes AND changes to player_payments.initial_cost or
--      .exempt (one new trigger on player_payments; it only reads).
--   2. History is never deleted. Installments are immutable except that an
--      active row may be marked superseded (replaced, exempt, cleared).
--      DELETE is refused; the payment_id key is ON DELETE RESTRICT.
--   3. Stale edits are refused. Every write function takes the version the
--      person was looking at (dues_state_version) and compares it AFTER taking
--      the same player_payments row lock that record_player_payment and
--      undo_player_payment take, so the check and the write cannot interleave
--      with a payment.
--   4. Clients cannot write these tables. Read-only RLS (same shape as
--      player_payments, including the parent restriction); every write goes
--      through the SECURITY DEFINER functions below, which check organization,
--      season and auth_can_write() BEFORE locking, like record_player_payment.
--
-- ROLLBACK (nothing else depends on these objects):
--   drop function if exists public.apply_dues_schedule(uuid, uuid, integer, jsonb), public.preview_dues_schedule(uuid, uuid[]),
--     public.dues_player_snapshot(uuid),
--     public.save_player_dues(uuid, text, numeric, boolean, jsonb), public.save_dues_template(uuid, uuid, integer, text, jsonb, boolean),
--     public.dues_state_version(uuid), public.dues_state_version_raw(uuid),
--     public.dues_validate_template_items(jsonb);
--   drop trigger dues_player_payments_total on public.player_payments;
--   drop table public.dues_installments; drop table public.dues_schedule_templates;
--   drop function public.dues_enforce_schedule_total(), public.dues_installments_guard();
--   Safe only while no schedules exist; with schedules, the tables are history and should be kept.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.dues_schedule_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  season_id       uuid not null references public.seasons (id),
  name            text not null check (length(btrim(name)) between 1 and 80),
  items           jsonb not null,
  is_default      boolean not null default false,
  revision        integer not null default 1,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index dues_schedule_templates_one_default
  on public.dues_schedule_templates (season_id) where is_default;
create index dues_schedule_templates_season on public.dues_schedule_templates (season_id);

create table public.dues_installments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  season_id          uuid not null references public.seasons (id),
  payment_id         uuid not null references public.player_payments (id) on delete restrict,
  seq                integer not null check (seq between 1 and 24),
  due_date           date not null,
  amount             numeric(10,2) not null check (amount > 0),
  source_template_id uuid references public.dues_schedule_templates (id),
  batch_key          uuid,
  superseded_at      timestamptz,
  superseded_reason  text check (superseded_reason in ('replaced', 'exempt', 'cleared')),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  constraint dues_installments_superseded_pair check ((superseded_at is null) = (superseded_reason is null))
);
create unique index dues_installments_active_seq
  on public.dues_installments (payment_id, seq) where superseded_at is null;
create unique index dues_installments_active_date
  on public.dues_installments (payment_id, due_date) where superseded_at is null;
create unique index dues_installments_batch
  on public.dues_installments (batch_key, payment_id, seq) where batch_key is not null;
create index dues_installments_payment on public.dues_installments (payment_id) where superseded_at is null;
create index dues_installments_season on public.dues_installments (season_id) where superseded_at is null;

-- ---------------------------------------------------------------------------
-- History is immutable
-- ---------------------------------------------------------------------------
create function public.dues_installments_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payment schedule history cannot be deleted.' using errcode = '42501';
  end if;
  if old.superseded_at is not null then
    raise exception 'This schedule entry was already replaced and cannot change.' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.season_id, new.payment_id, new.seq, new.due_date, new.amount,
      new.source_template_id, new.batch_key, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.season_id, old.payment_id, old.seq, old.due_date, old.amount,
      old.source_template_id, old.batch_key, old.created_by, old.created_at) then
    raise exception 'A scheduled payment cannot be edited. Replace the schedule instead.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger dues_installments_immutable
  before update or delete on public.dues_installments
  for each row execute function public.dues_installments_guard();

-- ---------------------------------------------------------------------------
-- Schedule total: checked at COMMIT, from both sides
-- ---------------------------------------------------------------------------
create function public.dues_enforce_schedule_total() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid;
  n   integer;
  s   numeric;
  pp  record;
begin
  if tg_table_name = 'dues_installments' then
    pid := new.payment_id;
  else
    pid := new.id;
  end if;
  select count(*), coalesce(sum(amount), 0) into n, s
    from public.dues_installments where payment_id = pid and superseded_at is null;
  if n = 0 then return null; end if;                -- no active schedule: nothing to enforce
  select initial_cost, exempt into pp from public.player_payments where id = pid;
  if not found then return null; end if;
  if pp.exempt then
    raise exception 'An exempt player cannot have an active payment schedule.' using errcode = '23514';
  end if;
  if round(s, 2) <> round(pp.initial_cost, 2) then
    raise exception 'The payment schedule (%) must add up to the total dues (%).', round(s, 2), round(pp.initial_cost, 2)
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger dues_installments_total
  after insert or update on public.dues_installments
  deferrable initially deferred for each row
  execute function public.dues_enforce_schedule_total();

create constraint trigger dues_player_payments_total
  after insert or update of initial_cost, exempt on public.player_payments
  deferrable initially deferred for each row
  execute function public.dues_enforce_schedule_total();

-- ---------------------------------------------------------------------------
-- Row security: read only for clients
-- ---------------------------------------------------------------------------
alter table public.dues_schedule_templates enable row level security;
alter table public.dues_installments enable row level security;

create policy "dues_schedule_templates: season read" on public.dues_schedule_templates
  for select using (
    season_id in (select auth_season_ids())
    and organization_id = (select auth_organization_id())
    and coalesce((select auth_org_role()), '') <> 'parent'
  );

create policy "dues_installments: season read" on public.dues_installments
  for select using (
    season_id in (select auth_season_ids())
    and organization_id = (select auth_organization_id())
    and (
      coalesce((select auth_org_role()), '') <> 'parent'
      or payment_id in (select pp.id from public.player_payments pp
                         where pp.player_id in (select auth_linked_player_ids()))
    )
  );

revoke all on public.dues_schedule_templates from public, anon, authenticated;
revoke all on public.dues_installments from public, anon, authenticated;
grant select on public.dues_schedule_templates to authenticated;
grant select on public.dues_installments to authenticated;

-- ---------------------------------------------------------------------------
-- Arithmetic and versions
-- ---------------------------------------------------------------------------

-- Returns a message when the template items are unusable, otherwise null.
-- Items are exact dates and dollar amounts, [{due_date, amount}]. Past dates are allowed:
-- a team already collecting dues enters the months that have already gone by.
create function public.dues_validate_template_items(p_items jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  e    jsonb;
  d    date;
  prev date;
  a    numeric;
  n    integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return 'The schedule needs a list of dates and amounts.'; end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 24 then return 'A schedule needs between 1 and 24 payments.'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    begin
      d := (e ->> 'due_date')::date;
      a := (e ->> 'amount')::numeric;
    exception when others then
      return 'Each payment needs a valid date and amount.';
    end;
    if d is null or a is null or a <= 0 or a <> round(a, 2) then return 'Each payment needs a date and an amount above zero, in dollars and cents.'; end if;
    if prev is not null and d <= prev then return 'Payment dates must be in order, with no repeats.'; end if;
    prev := d;
  end loop;
  return null;
end $$;

-- Internal. md5 over everything that must not change under an open screen:
-- total, exempt, every payment (reusing the undo fingerprint) and the active schedule.
create function public.dues_state_version_raw(p_payment_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select md5(
    public.player_payment_fingerprint(p_payment_id) || '#' ||
    coalesce((select string_agg(concat_ws('|', seq::text, due_date::text, round(amount, 2)::text), ';' order by seq)
                from public.dues_installments
               where payment_id = p_payment_id and superseded_at is null), '')
  );
$$;

-- What the app calls to learn the version of the player it is about to edit.
create function public.dues_state_version(p_payment_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare pre record;
begin
  select season_id, organization_id into pre from public.player_payments where id = p_payment_id;
  if not found
     or not (pre.season_id in (select auth_season_ids()))
     or pre.organization_id is distinct from (select auth_organization_id()) then
    return null;
  end if;
  return public.dues_state_version_raw(p_payment_id);
end $$;


-- The editor's starting point: the editable values AND their version, read together in one
-- STABLE call (one snapshot), so the amounts on the form can never be paired with a version
-- taken at another moment. The sheet must start from this, never from page data.
create function public.dues_player_snapshot(p_payment_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare pre record;
begin
  select season_id, organization_id, initial_cost, exempt into pre from public.player_payments where id = p_payment_id;
  if not found
     or not (pre.season_id in (select auth_season_ids()))
     or pre.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That player could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change payments.');
  end if;
  return jsonb_build_object('ok', true,
    'version', public.dues_state_version_raw(p_payment_id),
    'total', pre.initial_cost,
    'exempt', pre.exempt,
    'paid', (select coalesce(sum(amount), 0) from public.payment_log where payment_id = p_payment_id),
    'installments', (select coalesce(jsonb_agg(jsonb_build_object('due_date', due_date, 'amount', amount) order by seq), '[]'::jsonb)
                       from public.dues_installments where payment_id = p_payment_id and superseded_at is null));
end $$;

-- ---------------------------------------------------------------------------
-- Team schedule (template)
-- ---------------------------------------------------------------------------
create function public.save_dues_template(
  p_season_id        uuid,
  p_template_id      uuid,
  p_expected_revision integer,
  p_name             text,
  p_items            jsonb,
  p_is_default       boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  org uuid := (select auth_organization_id());
  msg text;
  t   record;
  v_id uuid;
begin
  if p_season_id is null or not (p_season_id in (select auth_season_ids())) or org is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That season could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change the team schedule.');
  end if;
  msg := public.dues_validate_template_items(p_items);
  if msg is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', msg);
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Give the schedule a name.');
  end if;

  -- Serialise default changes per season.
  perform 1 from public.seasons where id = p_season_id for update;

  if p_template_id is null then
    insert into public.dues_schedule_templates (organization_id, season_id, name, items, is_default)
    values (org, p_season_id, btrim(p_name), p_items, false)
    returning id into v_id;
  else
    select * into t from public.dues_schedule_templates
     where id = p_template_id and season_id = p_season_id and organization_id = org for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That schedule could not be found.');
    end if;
    if p_expected_revision is distinct from t.revision then
      return jsonb_build_object('ok', false, 'code', 'changed',
        'message', 'The team schedule was changed while you were editing. Nothing was saved.', 'revision', t.revision);
    end if;
    update public.dues_schedule_templates
       set name = btrim(p_name), items = p_items, revision = revision + 1, updated_at = now()
     where id = t.id;
    v_id := t.id;
  end if;

  if p_is_default then
    update public.dues_schedule_templates set is_default = false
     where season_id = p_season_id and id <> v_id and is_default;
    update public.dues_schedule_templates set is_default = true where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id,
    'revision', (select revision from public.dues_schedule_templates where id = v_id));
end $$;

-- ---------------------------------------------------------------------------
-- Preview: read only, no locks. Says what applying the schedule WOULD do.
-- Returns the ACTUAL recorded payments separately from the schedule, so the screen
-- can show money that was paid next to the installments it is calculated to cover.
-- Nothing here writes, and applying never creates or changes a payment.
-- ---------------------------------------------------------------------------
create function public.preview_dues_schedule(p_template_id uuid, p_payment_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tpl     record;
  tpl_cents bigint;
  rows    jsonb := '[]'::jsonb;
  pp      record;
  outc    text;
  credited numeric;
  pays    jsonb;
begin
  select * into tpl from public.dues_schedule_templates where id = p_template_id;
  if not found
     or not (tpl.season_id in (select auth_season_ids()))
     or tpl.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That schedule could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change payments.');
  end if;
  select coalesce(sum(round((e ->> 'amount')::numeric * 100)), 0)::bigint into tpl_cents
    from jsonb_array_elements(tpl.items) as e;

  for pp in
    select id, player_name, initial_cost, exempt
      from public.player_payments
     where id = any (coalesce(p_payment_ids, '{}'))
       and season_id = tpl.season_id and organization_id = tpl.organization_id
     order by player_name nulls last, id
  loop
    select coalesce(sum(amount), 0) into credited from public.payment_log where payment_id = pp.id;
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'paid_date', paid_date, 'amount', amount, 'label', month_label)
                              order by paid_date nulls last, id), '[]'::jsonb)
      into pays from public.payment_log where payment_id = pp.id;
    outc := case
      when pp.exempt then 'exempt'
      when pp.initial_cost <= 0 then 'no_dues'
      when round(pp.initial_cost * 100)::bigint <> tpl_cents then 'total_differs'
      when exists (select 1 from public.dues_installments where payment_id = pp.id and superseded_at is null) then 'has_schedule'
      else 'will_apply' end;
    rows := rows || jsonb_build_array(jsonb_build_object(
      'payment_id', pp.id, 'player_name', pp.player_name, 'outcome', outc,
      'total', pp.initial_cost, 'credited', credited, 'payments', pays,
      'version', public.dues_state_version_raw(pp.id)));
  end loop;

  return jsonb_build_object('ok', true, 'template_id', tpl.id, 'revision', tpl.revision,
    'template_total', tpl_cents / 100.0, 'items', tpl.items, 'players', rows);
end $$;

-- ---------------------------------------------------------------------------
-- Apply the team schedule to many players. All or nothing.
-- p_entries: [{payment_id, expected_version, replace}]
-- Writes installments ONLY. It never touches payment_log, so existing payments are
-- never re-entered, duplicated or changed; they simply start counting against the
-- installments (oldest first, in the app) the moment the schedule exists.
-- A player is eligible only when their total dues equal the schedule's total.
-- p_expected_revision is the team schedule revision the person REVIEWED (returned by
-- preview_dues_schedule). The template row is locked (for share) and compared, so a
-- change to the dates or amounts made after the review is refused, never applied.
-- ---------------------------------------------------------------------------
create function public.apply_dues_schedule(p_template_id uuid, p_batch_key uuid, p_expected_revision integer, p_entries jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tpl     record;
  org     uuid := (select auth_organization_id());
  ids     uuid[];
  pp      record;
  entry   jsonb;
  item    jsonb;
  stale   jsonb := '[]'::jsonb;
  blocked jsonb := '[]'::jsonb;
  tpl_cents bigint;
  has_sched boolean;
  applied integer := 0;
  i       integer;
begin
  if p_batch_key is null then
    raise exception 'A request key is required.' using errcode = '22023';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose at least one player.');
  end if;

  -- Who may do this is decided before any lock, as in record_player_payment.
  select * into tpl from public.dues_schedule_templates where id = p_template_id;
  if not found
     or not (tpl.season_id in (select auth_season_ids()))
     or tpl.organization_id is distinct from org then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That schedule could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change payments.');
  end if;
  if p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The reviewed schedule is missing. Review again.');
  end if;

  -- Lock the team schedule so nobody can edit it until this transaction ends, then read it
  -- again: what is compared and what is written below is exactly this locked row.
  select * into tpl from public.dues_schedule_templates where id = p_template_id for share;

  ids := array(select distinct (x ->> 'payment_id')::uuid from jsonb_array_elements(p_entries) as x);

  -- Lock every player row in a fixed order (no deadlock between two bulk runs).
  perform 1 from public.player_payments
   where id = any (ids) and season_id = tpl.season_id and organization_id = tpl.organization_id
   order by id for update;
  if (select count(*) from public.player_payments
       where id = any (ids) and season_id = tpl.season_id and organization_id = tpl.organization_id) <> coalesce(array_length(ids, 1), 0) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'One of those players could not be found. Nothing was saved.');
  end if;

  -- Repeat of an earlier submission: report it, add nothing. Checked under the locks.
  if exists (select 1 from public.dues_installments where batch_key = p_batch_key) then
    return jsonb_build_object('ok', true, 'duplicate', true,
      'applied', (select count(distinct payment_id) from public.dues_installments where batch_key = p_batch_key));
  end if;

  if p_expected_revision is distinct from tpl.revision then
    return jsonb_build_object('ok', false, 'code', 'template_changed', 'revision', tpl.revision,
      'message', 'The team schedule was changed after you reviewed it. Nothing was applied. Review it again.');
  end if;

  select coalesce(sum(round((e ->> 'amount')::numeric * 100)), 0)::bigint into tpl_cents
    from jsonb_array_elements(tpl.items) as e;

  -- Check everything before writing anything.
  for entry in select * from jsonb_array_elements(p_entries) loop
    select id, player_name, initial_cost, exempt into pp from public.player_payments where id = (entry ->> 'payment_id')::uuid;
    if (entry ->> 'expected_version') is distinct from public.dues_state_version_raw(pp.id) then
      stale := stale || jsonb_build_array(jsonb_build_object('payment_id', pp.id, 'player_name', pp.player_name));
      continue;
    end if;
    has_sched := exists (select 1 from public.dues_installments where payment_id = pp.id and superseded_at is null);
    if pp.exempt or pp.initial_cost <= 0 or round(pp.initial_cost * 100)::bigint <> tpl_cents
       or (has_sched and not coalesce((entry ->> 'replace')::boolean, false)) then
      blocked := blocked || jsonb_build_array(jsonb_build_object('payment_id', pp.id, 'player_name', pp.player_name,
        'reason', case when pp.exempt then 'exempt' when pp.initial_cost <= 0 then 'no_dues'
                       when round(pp.initial_cost * 100)::bigint <> tpl_cents then 'total_differs'
                       else 'has_schedule' end));
    end if;
  end loop;

  if jsonb_array_length(stale) > 0 then
    return jsonb_build_object('ok', false, 'code', 'changed', 'players', stale,
      'message', 'Some players changed while you were reviewing. Nothing was saved. Review the list again.');
  end if;
  if jsonb_array_length(blocked) > 0 then
    return jsonb_build_object('ok', false, 'code', 'not_eligible', 'players', blocked,
      'message', 'Some players cannot take this schedule as selected. Nothing was saved.');
  end if;

  for entry in select * from jsonb_array_elements(p_entries) loop
    select id into pp from public.player_payments where id = (entry ->> 'payment_id')::uuid;
    update public.dues_installments set superseded_at = now(), superseded_reason = 'replaced'
     where payment_id = pp.id and superseded_at is null;
    i := 0;
    for item in select * from jsonb_array_elements(tpl.items) loop
      i := i + 1;
      insert into public.dues_installments
        (organization_id, season_id, payment_id, seq, due_date, amount, source_template_id, batch_key)
      values (tpl.organization_id, tpl.season_id, pp.id, i, (item ->> 'due_date')::date, round((item ->> 'amount')::numeric, 2), tpl.id, p_batch_key);
    end loop;
    applied := applied + 1;
  end loop;

  return jsonb_build_object('ok', true, 'duplicate', false, 'applied', applied);
end $$;

-- ---------------------------------------------------------------------------
-- One player: total dues, exempt flag and schedule, saved together or not at all.
-- p_installments: null = leave the schedule alone, [] = clear it,
--                 [{due_date, amount}, ...] = replace it.
-- ---------------------------------------------------------------------------
create function public.save_player_dues(
  p_payment_id       uuid,
  p_expected_version text,
  p_total            numeric,
  p_exempt           boolean,
  p_installments     jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pre       record;
  pp        record;
  paid      numeric;
  total     numeric;
  n         integer;
  e         jsonb;
  d         date;
  a         numeric;
  prev      date;
  sum_c     bigint := 0;
  cur_same  boolean;
  has_active boolean;
  new_sched boolean := false;
  i         integer := 0;
begin
  -- Access first, before any lock (a caller outside the organization cannot queue on the row).
  select season_id, organization_id into pre from public.player_payments where id = p_payment_id;
  if not found
     or not (pre.season_id in (select auth_season_ids()))
     or pre.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That player could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change payments.');
  end if;

  -- The same row lock record_player_payment and undo_player_payment take. The version is
  -- compared only after it is held, so a payment cannot slip in between the check and the write.
  select id, initial_cost, exempt, organization_id, season_id into pp
    from public.player_payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That player could not be found.');
  end if;

  if p_expected_version is distinct from public.dues_state_version_raw(p_payment_id) then
    return jsonb_build_object('ok', false, 'code', 'changed',
      'message', 'This player''s dues, payments or schedule changed while you were looking. Nothing was saved.',
      'version', public.dues_state_version_raw(p_payment_id));
  end if;

  select coalesce(sum(amount), 0) into paid from public.payment_log where payment_id = p_payment_id;
  has_active := exists (select 1 from public.dues_installments where payment_id = p_payment_id and superseded_at is null);

  if p_total is null or p_total < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Enter the total dues.');
  end if;
  total := round(p_total, 2);

  if coalesce(p_exempt, false) then
    if paid > 0 then
      return jsonb_build_object('ok', false, 'code', 'exempt_with_payments',
        'message', 'This player has payments recorded, so they cannot be marked exempt. Remove or adjust the payment entries first.');
    end if;
    if p_installments is not null and jsonb_typeof(p_installments) = 'array' and jsonb_array_length(p_installments) > 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'An exempt player has no payment schedule.');
    end if;
    total := 0;
  elsif total < paid then
    return jsonb_build_object('ok', false, 'code', 'below_paid',
      'message', 'Total dues cannot be lower than what has already been paid.');
  end if;

  -- Validate and measure a replacement schedule.
  if p_installments is not null and not coalesce(p_exempt, false) then
    if jsonb_typeof(p_installments) <> 'array' then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The schedule is not valid.');
    end if;
    n := jsonb_array_length(p_installments);
    if n > 24 then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'A schedule can have at most 24 payments.');
    end if;
    for e in select * from jsonb_array_elements(p_installments) loop
      begin
        d := (e ->> 'due_date')::date;
        a := round((e ->> 'amount')::numeric, 2);
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Each payment needs a valid date and amount.');
      end;
      if d is null or a is null or a <= 0 then
        return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Each payment needs a date and an amount above zero.');
      end if;
      if prev is not null and d <= prev then
        return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Payment dates must be in order, with no repeats.');
      end if;
      prev := d;
      sum_c := sum_c + round(a * 100)::bigint;
    end loop;
    if n > 0 and sum_c <> round(total * 100)::bigint then
      return jsonb_build_object('ok', false, 'code', 'schedule_total_mismatch',
        'message', 'The payments add up to ' || to_char(sum_c / 100.0, 'FM999,999,990.00') ||
                   ' but the total dues are ' || to_char(total, 'FM999,999,990.00') || '. Nothing was saved.');
    end if;
    new_sched := n > 0;
  end if;

  -- Leaving the schedule alone while changing the total would strand the schedule.
  if p_installments is null and has_active and not coalesce(p_exempt, false) and total <> pp.initial_cost then
    return jsonb_build_object('ok', false, 'code', 'schedule_total_mismatch',
      'message', 'This player has a payment schedule. Change the total and the payments together. Nothing was saved.');
  end if;

  -- Is the replacement identical to what is already active? Then there is nothing to write there.
  cur_same := false;
  if p_installments is not null and not coalesce(p_exempt, false) and has_active then
    cur_same := (
      select coalesce(jsonb_agg(jsonb_build_object('d', due_date, 'a', amount) order by seq), '[]'::jsonb)
        from public.dues_installments where payment_id = p_payment_id and superseded_at is null
    ) = (
      select coalesce(jsonb_agg(jsonb_build_object('d', (x ->> 'due_date')::date, 'a', round((x ->> 'amount')::numeric, 2)) order by ord), '[]'::jsonb)
        from jsonb_array_elements(p_installments) with ordinality as t(x, ord)
    );
  end if;

  -- Nothing at all changes: report success without writing (safe to repeat).
  if total = pp.initial_cost and coalesce(p_exempt, false) = pp.exempt
     and (p_installments is null or (cur_same) or (not has_active and not new_sched)) then
    return jsonb_build_object('ok', true, 'unchanged', true, 'version', public.dues_state_version_raw(p_payment_id));
  end if;

  -- Schedule changes first (history kept), then the player's own row. The deferred
  -- total check runs once, at commit, over the finished state.
  if has_active and (coalesce(p_exempt, false) or (p_installments is not null and not cur_same)) then
    update public.dues_installments
       set superseded_at = now(),
           superseded_reason = case when coalesce(p_exempt, false) then 'exempt'
                                    when new_sched then 'replaced' else 'cleared' end
     where payment_id = p_payment_id and superseded_at is null;
  end if;
  if new_sched and not cur_same then
    for e in select * from jsonb_array_elements(p_installments) loop
      i := i + 1;
      insert into public.dues_installments (organization_id, season_id, payment_id, seq, due_date, amount)
      values (pp.organization_id, pp.season_id, p_payment_id, i, (e ->> 'due_date')::date, round((e ->> 'amount')::numeric, 2));
    end loop;
  end if;

  update public.player_payments
     set initial_cost = total, exempt = coalesce(p_exempt, false)
   where id = p_payment_id and (initial_cost is distinct from total or exempt is distinct from coalesce(p_exempt, false));

  return jsonb_build_object('ok', true, 'unchanged', false, 'version', public.dues_state_version_raw(p_payment_id));
end $$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.dues_installments_guard() from public, anon, authenticated;
revoke all on function public.dues_enforce_schedule_total() from public, anon, authenticated;
revoke all on function public.dues_state_version_raw(uuid) from public, anon, authenticated;
revoke all on function public.dues_validate_template_items(jsonb) from public, anon;
revoke all on function public.dues_state_version(uuid) from public, anon;
revoke all on function public.save_dues_template(uuid, uuid, integer, text, jsonb, boolean) from public, anon;
revoke all on function public.preview_dues_schedule(uuid, uuid[]) from public, anon;
revoke all on function public.apply_dues_schedule(uuid, uuid, integer, jsonb) from public, anon;
revoke all on function public.dues_player_snapshot(uuid) from public, anon;
revoke all on function public.save_player_dues(uuid, text, numeric, boolean, jsonb) from public, anon;

grant execute on function public.dues_validate_template_items(jsonb) to authenticated;
grant execute on function public.dues_state_version(uuid) to authenticated;
grant execute on function public.save_dues_template(uuid, uuid, integer, text, jsonb, boolean) to authenticated;
grant execute on function public.preview_dues_schedule(uuid, uuid[]) to authenticated;
grant execute on function public.apply_dues_schedule(uuid, uuid, integer, jsonb) to authenticated;
grant execute on function public.dues_player_snapshot(uuid) to authenticated;
grant execute on function public.save_player_dues(uuid, text, numeric, boolean, jsonb) to authenticated;
