-- mark_paid_01: atomic "Mark paid in full" with optional Finance payment (2026-11).
--
-- APPLIED to production 2026-11-19 (version 20261119172925) on the owner's approval and
-- verified: 2 request_key columns, 2 unique indexes, 2 operation tables with row security
-- and read-only client access, 7 functions (4 definer writers, 3 invoker readers).
-- The application code depends on everything below.
--
-- What it adds (nothing existing is changed or removed):
--   * budget_transactions.request_key and payment_log.request_key: a client
--     generated uuid per save attempt. A partial unique index makes a repeated
--     tap or retry impossible to record twice, atomically, in the database.
--   * tournament_payment_operations: one row per "Mark paid in full", holding
--     the previous state and a fingerprint of the tournament and its payments
--     after the save. It is what makes Undo safe.
--   * tournament_money_state(): the one place the balance is computed.
--   * tournament_payment_fingerprint(): hash of the tournament's status, cost,
--     budget line and every transaction linked to it.
--   * mark_tournament_paid_in_full(): status change plus Finance change in ONE
--     transaction, with a balance recheck and duplicate protection.
--   * undo_mark_tournament_paid_in_full(): reverses it, refusing when anything
--     changed afterwards.
--   * player_payment_operations: one row per recorded player payment, holding a
--     fingerprint of the player's dues and payments right after the save.
--   * record_player_payment(): a player payment with a balance recheck and
--     duplicate protection, atomic against other payments for the same player.
--   * undo_player_payment(operation_id): removes that payment only if the
--     player's dues and payments are exactly as the save left them. The
--     eligibility rule lives here; the caller supplies no counts or amounts.
--
-- Compatibility with the app that is live today: every change is additive.
-- The two new columns are nullable with no default, the unique indexes only
-- constrain rows that carry a request_key (the live app never sends one), the
-- new table and functions are not referenced by the live app, and no existing
-- policy, trigger, column or row is touched. The live app keeps working with
-- the migration applied and the new code not yet shipped.
--
-- Security: the three read helpers (tournament_money_state and the two
-- fingerprints) are SECURITY INVOKER, so the caller's row security applies.
-- The four writers (mark_tournament_paid_in_full, undo_mark_tournament_paid_in_full,
-- record_player_payment, undo_player_payment) are SECURITY DEFINER, and that is
-- deliberate: they are the ONLY way an operation record can be created or
-- changed, because clients have read-only access to both operation tables. Each
-- writer therefore repeats the row-security rule itself before touching
-- anything: the caller must be in the record's season and allowed to write
-- (parents and other organizations are refused). search_path is pinned. Every
-- business write they make is also one the caller could already make directly.
-- Parents can read neither the operation tables nor the transactions.
--
-- Rollback: drop the seven functions, the two tables, the two indexes and the two
-- columns. No existing row depends on any of them.

alter table public.budget_transactions add column if not exists request_key uuid;
alter table public.payment_log add column if not exists request_key uuid;

create unique index if not exists budget_transactions_request_key_uq
  on public.budget_transactions (organization_id, request_key) where request_key is not null;
create unique index if not exists payment_log_request_key_uq
  on public.payment_log (request_key) where request_key is not null;

create table if not exists public.tournament_payment_operations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  season_id         uuid not null references public.seasons(id),
  tournament_id     uuid not null references public.tournaments(id) on delete cascade,
  request_key       uuid not null,
  kind              text not null default 'mark_paid_in_full' check (kind = 'mark_paid_in_full'),
  previous          jsonb not null,
  after_fingerprint text not null,
  created_txn_id    uuid,
  touched_txn_id    uuid,
  result            jsonb not null,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  undone_at         timestamptz,
  unique (organization_id, request_key)
);

alter table public.tournament_payment_operations enable row level security;

create policy "tournament_payment_operations: season read"
  on public.tournament_payment_operations for select
  using (
    season_id in (select auth_season_ids())
    and coalesce((select auth_org_role()), '') <> 'parent'
  );

-- Read only for clients. Rows are written only by the functions below, which run
-- with the owner's rights; a client can neither create nor edit the records
-- that authorize an Undo.
revoke all on public.tournament_payment_operations from public, anon, authenticated;
grant select on public.tournament_payment_operations to authenticated;

-- ---------------------------------------------------------------------------
-- The balance, in one place. Paid = Paid expense transactions linked to the
-- tournament (a recorded deposit is one of these). To Pay entries are listed
-- separately. Remaining = cost minus Paid, never below zero.
-- ---------------------------------------------------------------------------
create or replace function public.tournament_money_state(p_tournament_id uuid)
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'status',     t.paid_status,
    'decision',   t.decision,
    'total_cost', round(coalesce(t.total_cost, 0), 2),
    'paid',       round(coalesce(p.paid, 0), 2),
    'remaining',  greatest(round(coalesce(t.total_cost, 0) - coalesce(p.paid, 0), 2), 0),
    'to_pay',     coalesce(tp.items, '[]'::jsonb)
  )
  from public.tournaments t
  left join lateral (
    select sum(b.actual_amount) as paid
    from public.budget_transactions b
    where b.tournament_id = t.id and not b.is_income
      and b.status = 'Paid' and b.actual_amount is not null
  ) p on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'amount', b.actual_amount,
             'txn_date', b.txn_date, 'budget_item_id', b.budget_item_id)
           order by b.txn_date, b.id) as items
    from public.budget_transactions b
    where b.tournament_id = t.id and not b.is_income and b.status = 'To Pay'
  ) tp on true
  where t.id = p_tournament_id;
$$;

create or replace function public.tournament_payment_fingerprint(p_tournament_id uuid)
returns text
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select md5(
    coalesce((
      select concat_ws('|', t.paid_status, t.decision,
               coalesce(round(t.total_cost, 2)::text, ''), coalesce(t.budget_item_id::text, ''))
      from public.tournaments t where t.id = p_tournament_id
    ), '')
    || '#' ||
    coalesce((
      select string_agg(
               concat_ws('|', b.id::text, coalesce(round(b.actual_amount, 2)::text, ''), b.status,
                 coalesce(b.txn_date::text, ''), coalesce(b.budget_item_id::text, ''), b.is_income::text),
               ';' order by b.id)
      from public.budget_transactions b where b.tournament_id = p_tournament_id
    ), '')
  );
$$;

-- ---------------------------------------------------------------------------
-- Mark paid in full. One transaction: the status and the Finance change both
-- happen or neither does.
--
-- p_expected_*: what the dialog showed. If the live figures differ the call
-- saves nothing and returns the new figures (code 'changed').
-- p_request_key: a repeat of the same key returns the first result untouched.
-- p_record_payment = false: status change only.
-- p_to_pay_id: mark that existing To Pay entry Paid (amount, date and budget
-- line editable) instead of creating a new transaction.
-- ---------------------------------------------------------------------------
create or replace function public.mark_tournament_paid_in_full(
  p_tournament_id        uuid,
  p_request_key          uuid,
  p_expected_status      text,
  p_expected_paid        numeric,
  p_expected_to_pay_count int,
  p_record_payment       boolean default false,
  p_to_pay_id            uuid    default null,
  p_amount               numeric default null,
  p_date                 date    default null,
  p_budget_item_id       uuid    default null,
  p_expected_cost        numeric default null,
  p_expected_to_pay      jsonb   default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  t         record;
  pre       record;
  op        record;
  txn       record;
  item      record;
  st        jsonb;
  cur_paid  numeric;
  cur_rem   numeric;
  cur_tp    int;
  v_amount  numeric;
  v_date    date;
  v_item_id uuid;
  v_prev    jsonb;
  v_created uuid;
  v_touched uuid;
  v_opid    uuid := gen_random_uuid();
  v_res     jsonb;
  n         int;
begin
  if p_request_key is null then
    raise exception 'A request key is required.' using errcode = '22023';
  end if;

  -- Who may touch this row is decided BEFORE any lock is taken, so a caller
  -- outside the organization or season cannot even queue on, or time, its lock.
  select season_id, organization_id into pre from public.tournaments where id = p_tournament_id;
  if not found
     or not (pre.season_id in (select auth_season_ids()))
     or pre.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That tournament could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change payments.');
  end if;

  -- Serialises everything for this tournament, so the recheck below is exact.
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found',
      'message', 'That tournament could not be found.');
  end if;

  -- This function runs with the owner's rights (it alone may write the
  -- operation records), so it repeats the row-security rule itself: the caller
  -- must belong to this tournament's season and be allowed to write.
  if not (t.season_id in (select auth_season_ids())) or t.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found',
      'message', 'That tournament could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden',
      'message', 'You do not have permission to change payments.');
  end if;

  -- Duplicate protection: the same key returns what the first call returned.
  select * into op from public.tournament_payment_operations
   where organization_id = t.organization_id and request_key = p_request_key;
  if found then
    return op.result || jsonb_build_object('duplicate', true, 'undone', op.undone_at is not null);
  end if;

  if t.decision is distinct from 'Committed' then
    return jsonb_build_object('ok', false, 'code', 'not_committed',
      'message', 'Commit to this tournament before marking it paid.');
  end if;
  if t.paid_status = 'Paid in Full' then
    return jsonb_build_object('ok', false, 'code', 'already_paid',
      'message', 'This tournament is already marked paid in full.');
  end if;
  if t.paid_status not in ('Registered', 'Deposit Paid') then
    return jsonb_build_object('ok', false, 'code', 'not_registered',
      'message', 'Mark this tournament registered first.');
  end if;

  -- Balance recheck.
  st       := public.tournament_money_state(t.id);
  cur_paid := (st->>'paid')::numeric;
  cur_rem  := (st->>'remaining')::numeric;
  cur_tp   := jsonb_array_length(st->'to_pay');
  -- Compared: status, paid so far, the tournament's cost, and every unpaid
  -- entry (which entries exist, and each one's amount, date and budget line).
  -- A changed cost or an edited unpaid entry is caught, not just a changed
  -- payment total or entry count.
  if t.paid_status is distinct from p_expected_status
     or cur_paid is distinct from coalesce(p_expected_paid, 0)
     or cur_tp   is distinct from coalesce(p_expected_to_pay_count, 0)
     or round(coalesce(t.total_cost, 0), 2) is distinct from round(coalesce(p_expected_cost, 0), 2)
     or jsonb_array_length(coalesce(p_expected_to_pay, '[]'::jsonb)) is distinct from cur_tp
     or exists (
          select 1 from jsonb_array_elements(st->'to_pay') l
           where not exists (
             select 1 from jsonb_array_elements(coalesce(p_expected_to_pay, '[]'::jsonb)) e
              where e->>'id' = l->>'id'
                and coalesce(round((e->>'amount')::numeric, 2), 0) = coalesce(round((l->>'amount')::numeric, 2), 0)
                and coalesce(e->>'txn_date', '') = coalesce(l->>'txn_date', '')
                and coalesce(e->>'budget_item_id', '') = coalesce(l->>'budget_item_id', ''))) then
    return jsonb_build_object('ok', false, 'code', 'changed',
      'message', 'The balance changed while you were looking at it. Nothing was saved.',
      'state', st);
  end if;

  v_prev := jsonb_build_object('paid_status', t.paid_status);

  if p_record_payment then
    if p_to_pay_id is not null then
      -- Mark the existing To Pay entry paid.
      select * into txn from public.budget_transactions
       where id = p_to_pay_id and tournament_id = t.id and not is_income and status = 'To Pay'
       for update;
      if not found then
        return jsonb_build_object('ok', false, 'code', 'changed',
          'message', 'That unpaid entry changed. Nothing was saved.', 'state', st);
      end if;
      v_amount  := coalesce(p_amount, txn.actual_amount);
      v_date    := coalesce(p_date, txn.txn_date, current_date);
      v_item_id := coalesce(p_budget_item_id, txn.budget_item_id);
    else
      if cur_tp > 0 then
        return jsonb_build_object('ok', false, 'code', 'to_pay_exists',
          'message', 'There is an unpaid entry for this tournament. Mark that entry paid instead.',
          'state', st);
      end if;
      v_amount  := coalesce(p_amount, cur_rem);
      v_date    := coalesce(p_date, current_date);
      v_item_id := coalesce(p_budget_item_id, t.budget_item_id);
    end if;

    -- Nothing left to record and no To Pay entry: status only.
    if p_to_pay_id is null and coalesce(v_amount, 0) = 0 then
      v_amount := null;
    end if;

    if v_amount is not null then
      if v_amount <= 0 then
        return jsonb_build_object('ok', false, 'code', 'invalid_amount',
          'message', 'Enter an amount greater than zero.');
      end if;
      if v_item_id is null then
        return jsonb_build_object('ok', false, 'code', 'budget_line_required',
          'message', 'Pick a budget line for this payment.');
      end if;
      select id, category, is_income, organization_id, season_id into item
        from public.budget_items where id = v_item_id;
      if not found or item.organization_id is distinct from t.organization_id
         or item.season_id is distinct from t.season_id then
        return jsonb_build_object('ok', false, 'code', 'invalid_budget_line',
          'message', 'That budget line is not part of this season.');
      end if;
      if item.is_income then
        return jsonb_build_object('ok', false, 'code', 'invalid_budget_line',
          'message', 'Tournament payments belong on an expense budget line.');
      end if;

      if p_to_pay_id is not null then
        v_prev := v_prev || jsonb_build_object('txn', jsonb_build_object(
          'id', txn.id, 'status', txn.status, 'actual_amount', txn.actual_amount,
          'txn_date', txn.txn_date, 'budget_item_id', txn.budget_item_id, 'category', txn.category));
        update public.budget_transactions
           set status = 'Paid', actual_amount = round(v_amount, 2), txn_date = v_date,
               budget_item_id = v_item_id, category = item.category
         where id = txn.id;
        get diagnostics n = row_count;
        if n <> 1 then raise exception 'Could not update the unpaid entry.' using errcode = '42501'; end if;
        v_touched := txn.id;
      else
        insert into public.budget_transactions
          (organization_id, season_id, tournament_id, budget_item_id, category, is_income,
           txn_date, item, quantity, actual_amount, status)
        values
          (t.organization_id, t.season_id, t.id, v_item_id, item.category, false,
           v_date, t.name || case when cur_paid > 0 then ' balance' else ' entry' end, 1,
           round(v_amount, 2), 'Paid')
        returning id into v_created;
      end if;
    end if;
  end if;

  update public.tournaments set paid_status = 'Paid in Full' where id = t.id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Could not update the tournament.' using errcode = '42501'; end if;

  v_res := jsonb_build_object(
    'ok', true, 'duplicate', false, 'operation_id', v_opid, 'tournament_id', t.id,
    'previous_status', t.paid_status, 'created_txn_id', v_created, 'touched_txn_id', v_touched,
    'recorded_amount', case when v_created is not null or v_touched is not null then round(v_amount, 2) end);

  insert into public.tournament_payment_operations
    (id, organization_id, season_id, tournament_id, request_key, previous,
     after_fingerprint, created_txn_id, touched_txn_id, result)
  values
    (v_opid, t.organization_id, t.season_id, t.id, p_request_key, v_prev,
     public.tournament_payment_fingerprint(t.id), v_created, v_touched, v_res);

  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Undo. Only when nothing about the tournament or its payments has changed
-- since the save: any later edit, payment, deletion or status change makes it
-- refuse, so Undo can never overwrite newer work.
-- ---------------------------------------------------------------------------
create or replace function public.undo_mark_tournament_paid_in_full(p_operation_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  op  record;
  pre record;
  t   record;
  tx  jsonb;
  n   int;
begin
  select season_id, organization_id into pre from public.tournament_payment_operations where id = p_operation_id;
  if not found
     or not (pre.season_id in (select auth_season_ids()))
     or pre.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That change could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change payments.');
  end if;
  select * into op from public.tournament_payment_operations where id = p_operation_id for update;
  if not found or not (op.season_id in (select auth_season_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That change could not be found.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You do not have permission to change payments.');
  end if;
  if op.undone_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_undone', 'message', 'That change was already undone.');
  end if;

  select * into t from public.tournaments where id = op.tournament_id for update;
  if not found
     or public.tournament_payment_fingerprint(op.tournament_id) is distinct from op.after_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'changed_since',
      'message', 'This tournament or its payments changed after that save, so it can''t be undone automatically. Nothing was changed.');
  end if;

  if op.created_txn_id is not null then
    delete from public.budget_transactions where id = op.created_txn_id and tournament_id = op.tournament_id;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'Could not remove the recorded payment.' using errcode = '42501'; end if;
  end if;

  if op.touched_txn_id is not null then
    tx := op.previous->'txn';
    update public.budget_transactions
       set status = tx->>'status',
           actual_amount = (tx->>'actual_amount')::numeric,
           txn_date = (tx->>'txn_date')::date,
           budget_item_id = (tx->>'budget_item_id')::uuid,
           category = tx->>'category'
     where id = op.touched_txn_id and tournament_id = op.tournament_id;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'Could not restore the unpaid entry.' using errcode = '42501'; end if;
  end if;

  update public.tournaments set paid_status = op.previous->>'paid_status' where id = op.tournament_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Could not restore the tournament status.' using errcode = '42501'; end if;

  update public.tournament_payment_operations set undone_at = now() where id = op.id;

  return jsonb_build_object('ok', true, 'tournament_id', op.tournament_id,
                            'restored_status', op.previous->>'paid_status');
end;
$$;

revoke all on function public.tournament_money_state(uuid) from public, anon;
revoke all on function public.tournament_payment_fingerprint(uuid) from public, anon;
revoke all on function public.mark_tournament_paid_in_full(uuid, uuid, text, numeric, int, boolean, uuid, numeric, date, uuid, numeric, jsonb) from public, anon;
revoke all on function public.undo_mark_tournament_paid_in_full(uuid) from public, anon;
grant execute on function public.tournament_money_state(uuid) to authenticated;
grant execute on function public.tournament_payment_fingerprint(uuid) to authenticated;
grant execute on function public.mark_tournament_paid_in_full(uuid, uuid, text, numeric, int, boolean, uuid, numeric, date, uuid, numeric, jsonb) to authenticated;
grant execute on function public.undo_mark_tournament_paid_in_full(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Player payments.
-- ---------------------------------------------------------------------------
create table if not exists public.player_payment_operations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  season_id         uuid not null references public.seasons(id),
  payment_id        uuid not null references public.player_payments(id) on delete cascade,
  request_key       uuid not null unique,
  entry_id          uuid not null,
  amount            numeric not null,
  after_fingerprint text not null,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  undone_at         timestamptz
);

alter table public.player_payment_operations enable row level security;

create policy "player_payment_operations: season read"
  on public.player_payment_operations for select
  using (
    season_id in (select auth_season_ids())
    and coalesce((select auth_org_role()), '') <> 'parent'
  );

-- Read only for clients. Rows are written only by the functions below, which run
-- with the owner's rights; a client can neither create nor edit the records
-- that authorize an Undo.
revoke all on public.player_payment_operations from public, anon, authenticated;
grant select on public.player_payment_operations to authenticated;

-- A hash of everything about one player's dues that a payment Undo must not
-- overwrite: what they owe, whether they are exempt, and every payment
-- (id, amount, date, month). Any later payment, edit, deletion, dues change or
-- exemption change makes the hash differ.
create or replace function public.player_payment_fingerprint(p_payment_id uuid)
returns text
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select md5(
    coalesce((select concat_ws('|', round(initial_cost, 2)::text, exempt::text)
                from public.player_payments where id = p_payment_id), '')
    || '#' ||
    coalesce((select string_agg(
                concat_ws('|', id::text, round(amount, 2)::text, coalesce(paid_date::text, ''), coalesce(month_label, '')),
                ';' order by id)
              from public.payment_log where payment_id = p_payment_id), '')
  );
$$;

-- Record a player payment. The player's obligation row is locked for the
-- duration, so two payments (two screens, two retries with different keys) for
-- the same player are applied one after the other: the second one sees the
-- first one's money when it rechecks the balance.
--
-- p_expected_paid: what the screen showed as paid so far. NULL skips the
-- recheck. A different live figure saves nothing and returns code 'changed'
-- with the live figures.
-- p_request_key: a repeat returns the first result and records nothing.
create or replace function public.record_player_payment(
  p_payment_id    uuid,
  p_request_key   uuid,
  p_expected_paid numeric,
  p_amount        numeric,
  p_date          date default null,
  p_month_label   text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
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

  -- Who may touch this row is decided BEFORE any lock is taken, so a caller
  -- outside the organization or season cannot even queue on, or time, its lock.
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
  -- Owner's rights (see the operation tables): repeat the row-security rule.
  if not (pp.season_id in (select auth_season_ids())) or pp.organization_id is distinct from (select auth_organization_id()) then
    return jsonb_build_object('ok', false, 'code', 'not_found',
      'message', 'Set what this player owes before recording a payment.');
  end if;
  if not coalesce((select auth_can_write()), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden',
      'message', 'You do not have permission to change payments.');
  end if;

  -- Duplicate protection, checked under the lock.
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
  -- A key that reached payment_log without an operation row (a caller that
  -- inserted directly) is still a duplicate.
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
$$;

-- Undo a recorded player payment. Eligibility is decided here, from state
-- stored at save time: the player's dues and payments must hash to exactly what
-- they were right after that save. The caller supplies only the operation id.
create or replace function public.undo_player_payment(p_operation_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
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

  -- Same lock, taken first, as record_player_payment (no deadlock, no interleaving).
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
$$;

revoke all on function public.player_payment_fingerprint(uuid) from public, anon;
revoke all on function public.record_player_payment(uuid, uuid, numeric, numeric, date, text) from public, anon;
revoke all on function public.undo_player_payment(uuid) from public, anon;
grant execute on function public.player_payment_fingerprint(uuid) to authenticated;
grant execute on function public.record_player_payment(uuid, uuid, numeric, numeric, date, text) to authenticated;
grant execute on function public.undo_player_payment(uuid) to authenticated;
