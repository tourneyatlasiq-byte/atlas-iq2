-- Local tests for supabase/pending/mark_tournament_paid_in_full.sql.
-- Run against the fixture schema only (scripts/sql/local/mark-paid-schema.sql):
--   scripts/test-mark-paid-local.sh
-- Fictional data. Not for Supabase.
drop schema if exists t cascade;
create schema t;
create table t.results (name text, ok boolean);
grant usage on schema t to public;
grant all on t.results to public;
create function t.chk(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  insert into t.results values (p_name, coalesce(p_ok, false));
  raise notice '%  %', case when coalesce(p_ok,false) then 'ok  ' else 'FAIL' end, p_name;
end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- Test convenience: the call a dialog makes when it is showing the live figures
-- (live cost and live unpaid entries read as the current user). Tests of a STALE
-- dialog call public.mark_tournament_paid_in_full directly with old values.
create function t.mark(tid uuid, k uuid, st text, paid numeric, cnt int, rec boolean, topay uuid, amt numeric, d date, line uuid)
returns jsonb language sql as $$
  select public.mark_tournament_paid_in_full(tid, k, st, paid, cnt, rec, topay, amt, d, line,
    (select total_cost from public.tournaments where id = tid),
    coalesce(public.tournament_money_state(tid)->'to_pay', '[]'::jsonb));
$$;

create function t.as_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

-- ---------- fixture data ----------
insert into organizations (id, name) values
  ('a0000000-0000-0000-0000-000000000001', 'Org A'), ('b0000000-0000-0000-0000-000000000001', 'Org B');
insert into seasons (id, team_id, name, phase) values
  ('5a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A current', 'current'),
  ('5a000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'A past', 'past'),
  ('5b000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'B current', 'current');
insert into test_memberships values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'owner'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'coach'),
  ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'parent'),
  ('10000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'coach');
insert into budget_items (id, organization_id, season_id, category, name, is_income) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'Tournaments', 'Tournament fees', false),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'Facilities', 'Field rental', false),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'Sponsors', 'Sponsor income', true),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 'Tournaments', 'Org B fees', false),
  ('e0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000002', 'Tournaments', 'Past season fees', false);

-- tournaments (id prefix c0.. = tournament)
-- T1: Deposit Paid, cost 650, $300 deposit recorded as Paid. Remaining 350.
-- T2: Registered, cost 500, nothing recorded.
-- T3: Registered, cost 450, one To Pay entry of 450.
-- T4: Deposit Paid, cost 400, deposit 400 already recorded (remaining 0).
-- T5: Not Registered.  T6: Considering.  T7: already Paid in Full.
-- T8: named FAIL (a trigger makes its status update fail, to prove atomicity).
-- T9: past season.  T10: Org B.  T11: Registered cost 300, used for Undo-after-change tests.
-- T12: Registered cost 600 (idempotency/concurrency).
insert into tournaments (id, organization_id, season_id, name, entry_fee, gate_fee, decision, paid_status, budget_item_id) values
 ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','T1 Deposit',650,0,'Committed','Deposit Paid','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','T2 Registered',500,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','T3 ToPay',450,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','T4 Settled',400,0,'Committed','Deposit Paid','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','T5 NotReg',300,0,'Committed','Not Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','T6 Considering',300,0,'Considering','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','T7 AlreadyPaid',300,0,'Committed','Paid in Full','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','FAIL',200,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000002','T9 Past',300,0,'Committed','Registered','e0000000-0000-0000-0000-000000000005'),
 ('c0000000-0000-0000-0000-000000000010','b0000000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001','T10 OrgB',300,0,'Committed','Registered','e0000000-0000-0000-0000-000000000004'),
 ('c0000000-0000-0000-0000-000000000011','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','T11 UndoGuard',300,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000012','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','T12 Dup',600,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001');

create function t.fail_status() returns trigger language plpgsql as $$
begin if new.name = 'FAIL' and new.paid_status is distinct from old.paid_status then raise exception 'forced failure'; end if; return new; end $$;
create trigger t_fail before update on tournaments for each row execute function t.fail_status();

insert into budget_transactions (id, organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status, txn_date) values
 ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Tournaments','T1 deposit',300,'Paid','2026-10-20'),
 ('d0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000001','Tournaments','T3 entry',450,'To Pay','2026-11-01'),
 ('d0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000001','Tournaments','T4 deposit',400,'Paid','2026-10-20');

do $$
declare
  owner_ uuid := '10000000-0000-0000-0000-000000000001'; coach uuid := '10000000-0000-0000-0000-000000000002';
  parent_ uuid := '10000000-0000-0000-0000-000000000003'; coachb uuid := '10000000-0000-0000-0000-000000000004';
  r jsonb; r2 jsonb; k uuid; n int; before_fp text; st text; op uuid; amt numeric; stt text;
  T1 uuid := 'c0000000-0000-0000-0000-000000000001'; T2 uuid := 'c0000000-0000-0000-0000-000000000002';
  T3 uuid := 'c0000000-0000-0000-0000-000000000003'; T4 uuid := 'c0000000-0000-0000-0000-000000000004';
  T5 uuid := 'c0000000-0000-0000-0000-000000000005'; T6 uuid := 'c0000000-0000-0000-0000-000000000006';
  T7 uuid := 'c0000000-0000-0000-0000-000000000007'; T8 uuid := 'c0000000-0000-0000-0000-000000000008';
  T9 uuid := 'c0000000-0000-0000-0000-000000000009'; T10 uuid := 'c0000000-0000-0000-0000-000000000010';
  T11 uuid := 'c0000000-0000-0000-0000-000000000011'; T12 uuid := 'c0000000-0000-0000-0000-000000000012';
  L1 uuid := 'e0000000-0000-0000-0000-000000000001'; L2 uuid := 'e0000000-0000-0000-0000-000000000002';
  LINC uuid := 'e0000000-0000-0000-0000-000000000003'; LB uuid := 'e0000000-0000-0000-0000-000000000004';
begin
  raise notice E'\n== Money state ==';
  perform t.as_user(owner_);
  r := public.tournament_money_state(T1);
  perform t.as_admin();
  perform t.chk('T1: paid 300, remaining 350 (deposit counted, not the full fee)', (r->>'paid')::numeric = 300 and (r->>'remaining')::numeric = 350);
  perform t.as_user(owner_); r := public.tournament_money_state(T3); perform t.as_admin();
  perform t.chk('T3: To Pay entry listed, nothing paid, remaining 450', jsonb_array_length(r->'to_pay') = 1 and (r->>'paid')::numeric = 0 and (r->>'remaining')::numeric = 450);

  raise notice E'\n== Happy path: new Paid transaction for the remaining balance only ==';
  k := gen_random_uuid();
  perform t.as_user(owner_);
  r := t.mark(T1, k, 'Deposit Paid', 300, 0, true, null, null, '2026-11-19', null);
  perform t.as_admin();
  perform t.chk('T1: ok', r->>'ok' = 'true');
  perform t.chk('T1: recorded amount is the 350 balance, not 650', (r->>'recorded_amount')::numeric = 350);
  select count(*) into n from budget_transactions where tournament_id = T1; perform t.chk('T1: exactly one new transaction (two total)', n = 2);
  select actual_amount, status into amt, stt from budget_transactions where id = (r->>'created_txn_id')::uuid;
  perform t.chk('T1: new transaction is Paid 350 on the tournament line', amt = 350 and stt = 'Paid');
  select paid_status into st from tournaments where id = T1; perform t.chk('T1: tournament is Paid in Full', st = 'Paid in Full');
  op := (r->>'operation_id')::uuid;

  raise notice E'\n== Duplicate protection ==';
  perform t.as_user(owner_);
  r2 := t.mark(T1, k, 'Deposit Paid', 300, 0, true, null, null, '2026-11-19', null);
  perform t.as_admin();
  perform t.chk('repeat of the same key reports duplicate', r2->>'duplicate' = 'true');
  perform t.chk('repeat returns the same operation', (r2->>'operation_id')::uuid = op);
  select count(*) into n from budget_transactions where tournament_id = T1; perform t.chk('repeat created no second transaction', n = 2);
  select count(*) into n from tournament_payment_operations where tournament_id = T1; perform t.chk('one operation row', n = 1);
  -- a retry after the tournament is already Paid, with a NEW key, is refused rather than recorded again
  perform t.as_user(owner_);
  r2 := t.mark(T1, gen_random_uuid(), 'Deposit Paid', 300, 0, true, null, null, null, null);
  perform t.as_admin();
  perform t.chk('different key after success is refused (already_paid)', r2->>'code' = 'already_paid');
  select count(*) into n from budget_transactions where tournament_id = T1; perform t.chk('...and still two transactions', n = 2);

  raise notice E'\n== Undo of the created payment ==';
  perform t.as_user(owner_); r := public.undo_mark_tournament_paid_in_full(op); perform t.as_admin();
  perform t.chk('undo ok', r->>'ok' = 'true');
  select count(*) into n from budget_transactions where tournament_id = T1; perform t.chk('created transaction removed, deposit kept', n = 1);
  select paid_status into st from tournaments where id = T1; perform t.chk('status restored to Deposit Paid', st = 'Deposit Paid');
  perform t.as_user(owner_); r := public.undo_mark_tournament_paid_in_full(op); perform t.as_admin();
  perform t.chk('second undo refused (already_undone)', r->>'code' = 'already_undone');

  raise notice E'\n== Balance recheck ==';
  insert into budget_transactions (organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status)
    values ('a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001', T2, L1, 'Tournaments', 'someone else paid 100', 100, 'Paid');
  select tournament_payment_fingerprint(T2) into before_fp;
  perform t.as_user(owner_);
  r := t.mark(T2, gen_random_uuid(), 'Registered', 0, 0, true, null, null, null, null);
  perform t.as_admin();
  perform t.chk('stale paid figure refused with code changed', r->>'code' = 'changed');
  perform t.chk('...and returns the live remaining balance (400)', (r->'state'->>'remaining')::numeric = 400);
  select paid_status into st from tournaments where id = T2; perform t.chk('...tournament untouched', st = 'Registered');
  perform t.chk('...nothing changed at all (fingerprint)', tournament_payment_fingerprint(T2) = before_fp);
  perform t.as_user(owner_);
  r := t.mark(T2, gen_random_uuid(), 'Deposit Paid', 100, 0, true, null, null, null, null);
  perform t.as_admin();
  perform t.chk('stale status figure refused', r->>'code' = 'changed');
  perform t.as_user(owner_);
  r := t.mark(T2, gen_random_uuid(), 'Registered', 100, 0, true, null, null, null, null);
  perform t.as_admin();
  perform t.chk('with the live figures it saves', r->>'ok' = 'true');
  perform t.chk('and records the new 400 remaining', (r->>'recorded_amount')::numeric = 400);

  raise notice E'\n== Existing To Pay entry is marked Paid, not duplicated ==';
  select tournament_payment_fingerprint(T3) into before_fp;
  perform t.as_user(owner_);
  r := t.mark(T3, gen_random_uuid(), 'Registered', 0, 1, true, null, null, null, null);
  perform t.as_admin();
  perform t.chk('recording a new payment while a To Pay entry exists is refused', r->>'code' = 'to_pay_exists');
  perform t.chk('...nothing changed', tournament_payment_fingerprint(T3) = before_fp);
  perform t.as_user(owner_);
  r := t.mark(T3, gen_random_uuid(), 'Registered', 0, 1, true,
         'd0000000-0000-0000-0000-000000000003', 430, '2026-11-18', L2);
  perform t.as_admin();
  perform t.chk('marking the existing entry paid with edited amount, date and line: ok', r->>'ok' = 'true');
  select count(*) into n from budget_transactions where tournament_id = T3; perform t.chk('no second transaction was created', n = 1);
  perform t.chk('To Pay entry now Paid at 430 on 2026-11-18 on the Facilities line',
    exists (select 1 from budget_transactions where id='d0000000-0000-0000-0000-000000000003'
            and status='Paid' and actual_amount=430 and txn_date='2026-11-18' and budget_item_id=L2 and category='Facilities'));
  op := (r->>'operation_id')::uuid;
  perform t.as_user(owner_); r := public.undo_mark_tournament_paid_in_full(op); perform t.as_admin();
  perform t.chk('undo restores the To Pay entry exactly (To Pay, 450, 2026-11-01, Tournaments line)',
    r->>'ok'='true' and exists (select 1 from budget_transactions where id='d0000000-0000-0000-0000-000000000003'
            and status='To Pay' and actual_amount=450 and txn_date='2026-11-01' and budget_item_id=L1 and category='Tournaments'));
  select paid_status into st from tournaments where id=T3; perform t.chk('T3 status restored to Registered', st='Registered');

  raise notice E'\n== Status only (no Finance record) ==';
  perform t.as_user(owner_);
  r := t.mark(T4, gen_random_uuid(), 'Deposit Paid', 400, 0, false, null, null, null, null);
  perform t.as_admin();
  perform t.chk('T4 status only: ok, no transaction created', r->>'ok'='true' and r->>'created_txn_id' is null);
  select count(*) into n from budget_transactions where tournament_id=T4; perform t.chk('T4 still one transaction', n=1);
  -- remaining 0 with record_payment true: status only, no zero-value record
  update tournaments set paid_status='Deposit Paid' where id=T4;
  perform t.as_user(owner_);
  r := t.mark(T4, gen_random_uuid(), 'Deposit Paid', 400, 0, true, null, null, null, null);
  perform t.as_admin();
  perform t.chk('T4 balance already 0 with record on: ok and no $0 record', r->>'ok'='true' and r->>'created_txn_id' is null);

  raise notice E'\n== State rules ==';
  perform t.as_user(owner_);
  r := t.mark(T5, gen_random_uuid(), 'Not Registered', 0, 0, false, null, null, null, null);
  perform t.chk('not registered refused', r->>'code'='not_registered');
  r := t.mark(T6, gen_random_uuid(), 'Registered', 0, 0, false, null, null, null, null);
  perform t.chk('not committed refused', r->>'code'='not_committed');
  r := t.mark(T7, gen_random_uuid(), 'Paid in Full', 0, 0, false, null, null, null, null);
  perform t.chk('already paid refused', r->>'code'='already_paid');
  r := t.mark(T12, gen_random_uuid(), 'Registered', 0, 0, true, null, 100, null, L1) ;
  perform t.chk('partial amount allowed and recorded (user edited to 100)', r->>'ok'='true' and (r->>'recorded_amount')::numeric=100);
  perform t.as_admin();
  update tournaments set paid_status='Registered' where id=T12;
  delete from budget_transactions where tournament_id=T12; delete from tournament_payment_operations where tournament_id=T12;
  perform t.as_user(owner_);
  r := t.mark(T12, gen_random_uuid(), 'Registered', 0, 0, true, null, 600, null, LINC);
  perform t.chk('income budget line refused', r->>'code'='invalid_budget_line');
  r := t.mark(T12, gen_random_uuid(), 'Registered', 0, 0, true, null, 600, null, LB);
  perform t.chk('another organization budget line refused', r->>'code'='invalid_budget_line');
  r := t.mark(T12, gen_random_uuid(), 'Registered', 0, 0, true, null, -5, null, L1);
  perform t.chk('negative amount refused', r->>'code'='invalid_amount');
  perform t.as_admin();
  select count(*) into n from budget_transactions where tournament_id=T12; perform t.chk('refusals left no records', n=0);
  select paid_status into st from tournaments where id=T12; perform t.chk('refusals left status alone', st='Registered');

  raise notice E'\n== Atomicity: status update fails after the payment insert ==';
  select count(*) into n from budget_transactions where tournament_id=T8; perform t.chk('T8 starts with none', n=0);
  perform t.as_user(owner_);
  begin
    r := t.mark(T8, gen_random_uuid(), 'Registered', 0, 0, true, null, null, null, null);
    perform t.as_admin(); perform t.chk('forced failure raised', false);
  exception when others then
    perform t.as_admin(); perform t.chk('forced failure raised an error', sqlerrm = 'forced failure');
  end;
  perform t.as_admin();
  select count(*) into n from budget_transactions where tournament_id=T8; perform t.chk('payment insert rolled back with it', n=0);
  select paid_status into st from tournaments where id=T8; perform t.chk('status unchanged', st='Registered');
  select count(*) into n from tournament_payment_operations where tournament_id=T8; perform t.chk('no operation row', n=0);

  raise notice E'\n== Permissions and tenant isolation ==';
  perform t.as_user(parent_);
  r := public.tournament_money_state(T1);
  perform t.as_admin();
  perform t.chk('parent sees no transactions so paid is 0 (cannot read budget)', (r->>'paid')::numeric = 0);
  perform t.as_user(parent_);
  begin
    r := t.mark(T2, gen_random_uuid(), 'Registered', 0, 0, false, null, null, null, null);
    perform t.as_admin(); perform t.chk('parent write refused', r->>'code' = 'not_found' or r->>'ok' <> 'true');
  exception when others then perform t.as_admin(); perform t.chk('parent write refused (error)', true); end;
  select paid_status into st from tournaments where id=T2; perform t.chk('parent changed nothing on T2 (still Paid in Full from earlier owner save)', st='Paid in Full');
  perform t.as_user(coachb);
  r := t.mark(T11, gen_random_uuid(), 'Registered', 0, 0, false, null, null, null, null);
  perform t.as_admin();
  perform t.chk('other organization cannot see or change T11', r->>'code'='not_found');
  select paid_status into st from tournaments where id=T11; perform t.chk('T11 untouched', st='Registered');
  perform t.as_user(coach);
  r := t.mark(T10, gen_random_uuid(), 'Registered', 0, 0, false, null, null, null, null);
  perform t.as_admin();
  perform t.chk('Org A coach cannot touch Org B tournament', r->>'code'='not_found');

  raise notice E'\n== Past season ==';
  perform t.as_user(coach);
  begin
    r := t.mark(T9, gen_random_uuid(), 'Registered', 0, 0, true, null, null, null, 'e0000000-0000-0000-0000-000000000005');
    perform t.as_admin(); perform t.chk('coach in finished season refused', r->>'ok' <> 'true');
  exception when others then perform t.as_admin(); perform t.chk('coach in finished season refused (error)', true); end;
  perform t.as_admin();
  select paid_status into st from tournaments where id=T9; perform t.chk('T9 unchanged', st='Registered');
  select count(*) into n from budget_transactions where tournament_id=T9; perform t.chk('T9 no records', n=0);

  raise notice E'\n== Undo safeguards: later edits and payments block Undo ==';
  -- later payment added
  perform t.as_user(owner_);
  r := t.mark(T11, gen_random_uuid(), 'Registered', 0, 0, true, null, null, null, null);
  perform t.as_admin();
  op := (r->>'operation_id')::uuid; k := (r->>'created_txn_id')::uuid;
  insert into budget_transactions (organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status)
    values ('a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001', T11, L1, 'Tournaments', 'refund adjustment', 25, 'Paid');
  perform t.as_user(owner_); r := public.undo_mark_tournament_paid_in_full(op); perform t.as_admin();
  perform t.chk('undo refused after a later payment', r->>'code'='changed_since');
  select paid_status into st from tournaments where id=T11; perform t.chk('...status still Paid in Full', st='Paid in Full');
  select count(*) into n from budget_transactions where tournament_id=T11; perform t.chk('...both transactions kept', n=2);
  -- later edit of the created transaction (amount)
  delete from budget_transactions where tournament_id=T11 and item='refund adjustment';
  update budget_transactions set actual_amount = 299 where id = k;
  perform t.as_user(owner_); r := public.undo_mark_tournament_paid_in_full(op); perform t.as_admin();
  perform t.chk('undo refused after the recorded payment was edited', r->>'code'='changed_since');
  update budget_transactions set actual_amount = 300 where id = k;
  -- later status change
  update tournaments set paid_status='Registered' where id=T11;
  perform t.as_user(owner_); r := public.undo_mark_tournament_paid_in_full(op); perform t.as_admin();
  perform t.chk('undo refused after a later status change', r->>'code'='changed_since');
  update tournaments set paid_status='Paid in Full' where id=T11;
  -- later cost change
  update tournaments set entry_fee = 350 where id=T11;
  perform t.as_user(owner_); r := public.undo_mark_tournament_paid_in_full(op); perform t.as_admin();
  perform t.chk('undo refused after the cost changed', r->>'code'='changed_since');
  update tournaments set entry_fee = 300 where id=T11;
  -- deleted
  delete from budget_transactions where id=k;
  perform t.as_user(owner_); r := public.undo_mark_tournament_paid_in_full(op); perform t.as_admin();
  perform t.chk('undo refused after the recorded payment was deleted', r->>'code'='changed_since');
  select paid_status into st from tournaments where id=T11; perform t.chk('...nothing was overwritten', st='Paid in Full');
  select count(*) into n from tournament_payment_operations where id=op and undone_at is null; perform t.chk('...operation still open', n=1);
  -- parent cannot undo
  perform t.as_user(parent_);
  begin r := public.undo_mark_tournament_paid_in_full(op); perform t.as_admin(); perform t.chk('parent undo is refused (forbidden: a member who may not write)', r->>'code' in ('forbidden','not_found'));
  exception when others then perform t.as_admin(); perform t.chk('parent undo refused (error)', true); end;

  raise notice E'\n== Structure checks ==';
  perform t.as_admin();
  perform t.chk('request_key unique index exists on budget_transactions',
    exists (select 1 from pg_indexes where indexname='budget_transactions_request_key_uq'));
  perform t.chk('request_key unique index exists on payment_log',
    exists (select 1 from pg_indexes where indexname='payment_log_request_key_uq'));
  perform t.chk('RLS is on for the operations table',
    (select relrowsecurity from pg_class where oid='public.tournament_payment_operations'::regclass));
  perform t.chk('the read helpers run as the caller (security invoker, so row security applies to them)',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname in ('tournament_money_state','tournament_payment_fingerprint','player_payment_fingerprint') and p.prosecdef));
end $$;

-- ---------------- player payments ----------------
insert into player_payments (id, organization_id, season_id, player_name, initial_cost) values
 ('f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','Player One',1000),
 ('f0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','Player Two',1000),
 ('f0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000002','Past Player',1000),
 ('f0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001','Org B Player',1000);
insert into payment_log (payment_id, amount, paid_date) values ('f0000000-0000-0000-0000-000000000001', 200, '2026-10-01');

do $$
declare
  owner_ uuid := '10000000-0000-0000-0000-000000000001'; coach uuid := '10000000-0000-0000-0000-000000000002';
  parent_ uuid := '10000000-0000-0000-0000-000000000003'; coachb uuid := '10000000-0000-0000-0000-000000000004';
  P1 uuid := 'f0000000-0000-0000-0000-000000000001'; P2 uuid := 'f0000000-0000-0000-0000-000000000002';
  P3 uuid := 'f0000000-0000-0000-0000-000000000003'; P4 uuid := 'f0000000-0000-0000-0000-000000000004';
  r jsonb; r2 jsonb; k uuid; n int; e1 uuid; e2 uuid; c int; op uuid;
begin
  raise notice E'\n== Player payments ==';
  k := gen_random_uuid();
  perform t.as_user(owner_);
  r := public.record_player_payment(P1, k, 200, 300, '2026-11-19', 'Nov');
  perform t.as_admin();
  perform t.chk('player payment saves with the live balance', r->>'ok'='true' and (r->>'paid')::numeric=500 and (r->>'entry_count')::int=2);
  e1 := (r->>'id')::uuid;
  perform t.as_user(owner_); r2 := public.record_player_payment(P1, k, 200, 300, '2026-11-19', 'Nov'); perform t.as_admin();
  perform t.chk('retry with the same key returns the first entry', r2->>'duplicate'='true' and (r2->>'id')::uuid=e1);
  select count(*) into n from payment_log where payment_id=P1; perform t.chk('retry recorded nothing new (2 entries)', n=2);
  perform t.as_user(owner_); r2 := public.record_player_payment(P1, gen_random_uuid(), 200, 50, null, null); perform t.as_admin();
  perform t.chk('stale expected paid is refused with the live figures', r2->>'code'='changed' and (r2->>'paid')::numeric=500 and (r2->>'entry_count')::int=2);
  select count(*) into n from payment_log where payment_id=P1; perform t.chk('...and nothing was saved', n=2);
  perform t.as_user(owner_); r2 := public.record_player_payment(P2, k, 0, 1, null, null); perform t.as_admin();
  perform t.chk('same key on another player is refused (key_reused)', r2->>'code'='key_reused');
  perform t.as_user(owner_); r2 := public.record_player_payment(P2, gen_random_uuid(), 0, -5, null, null); perform t.as_admin();
  perform t.chk('non-positive amount refused', r2->>'code'='invalid_amount');
  perform t.as_user(owner_); r2 := public.record_player_payment(P2, gen_random_uuid(), null, 75, null, null); perform t.as_admin();
  perform t.chk('null expected skips the recheck', r2->>'ok'='true');
  perform t.as_user(owner_); r2 := public.record_player_payment(gen_random_uuid(), gen_random_uuid(), 0, 10, null, null); perform t.as_admin();
  perform t.chk('unknown obligation refused (not_found)', r2->>'code'='not_found');

  raise notice E'\n== Player payment Undo: eligibility decided by the database ==';
  perform t.chk('the save returned an operation id', (r->>'operation_id') is not null);
  perform t.as_user(owner_); r := public.record_player_payment(P2, gen_random_uuid(), null, 80, null, null); perform t.as_admin();
  -- P2 now has: 75 (earlier), 80
  op := (r->>'operation_id')::uuid; e1 := (r->>'id')::uuid;
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('undo removes only that payment when nothing changed since', r2->>'ok'='true');
  select count(*) into n from payment_log where payment_id=P2 and amount=75; perform t.chk('the earlier payment is kept', n=1);
  select count(*) into n from payment_log where id=e1; perform t.chk('the undone payment is gone', n=0);
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('repeated undo is refused (already_undone)', r2->>'code'='already_undone');
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('...and again', r2->>'code'='already_undone');
  select count(*) into n from payment_log where payment_id=P2; perform t.chk('...nothing else removed', n=1);

  -- omitted or unknown operation
  perform t.as_user(owner_); r2 := public.undo_player_payment(null); perform t.as_admin();
  perform t.chk('omitted operation id is refused', r2->>'code'='not_found');
  perform t.as_user(owner_); r2 := public.undo_player_payment(gen_random_uuid()); perform t.as_admin();
  perform t.chk('unknown operation id is refused', r2->>'code'='not_found');

  -- each kind of later change blocks Undo
  perform t.as_user(owner_); r := public.record_player_payment(P2, gen_random_uuid(), null, 10, '2026-11-19', 'Nov'); perform t.as_admin();
  op := (r->>'operation_id')::uuid; e1 := (r->>'id')::uuid;
  perform t.as_user(coach); r2 := public.record_player_payment(P2, gen_random_uuid(), null, 5, null, null); perform t.as_admin();
  e2 := (r2->>'id')::uuid;
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('refused after a later payment for the same player', r2->>'code'='changed_since');
  select count(*) into n from payment_log where id in (e1, e2); perform t.chk('...both payments still there', n=2);
  delete from payment_log where id=e2;
  perform t.chk('removing the later payment restores the saved state exactly, so undo becomes eligible again',
    (select after_fingerprint from player_payment_operations where id=op) = player_payment_fingerprint(P2));
  update payment_log set amount = 11 where id=e1;
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('refused after the payment amount was edited', r2->>'code'='changed_since');
  update payment_log set amount = 10, paid_date = '2026-11-01' where id=e1;
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('refused after the payment date was edited', r2->>'code'='changed_since');
  update payment_log set paid_date = '2026-11-19' where id=e1;
  update player_payments set initial_cost = 1200 where id=P2;
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('refused after what the player owes was changed', r2->>'code'='changed_since');
  update player_payments set initial_cost = 1000 where id=P2;
  update player_payments set initial_cost = 0, exempt = true where id=P2;
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('refused after the player was marked exempt', r2->>'code'='changed_since');
  update player_payments set initial_cost = 1000, exempt = false where id=P2;
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('allowed once everything is exactly as saved again', r2->>'ok'='true');
  -- an earlier payment edited, an earlier one deleted
  perform t.as_user(owner_); r := public.record_player_payment(P2, gen_random_uuid(), null, 7, null, null); perform t.as_admin();
  op := (r->>'operation_id')::uuid;
  delete from payment_log where payment_id=P2 and amount=75;
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('refused after an EARLIER payment was deleted', r2->>'code'='changed_since');
  select count(*) into n from payment_log where payment_id=P2 and amount=7; perform t.chk('...the 7 payment is untouched', n=1);
  -- the payment itself deleted
  delete from payment_log where id=(select entry_id from player_payment_operations where id=op);
  perform t.as_user(owner_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('refused after the payment itself was deleted', r2->>'code'='changed_since');
  select count(*) into n from player_payment_operations where id=op and undone_at is null; perform t.chk('...the operation stays open', n=1);

  -- duplicate key returns the operation
  k := gen_random_uuid();
  perform t.as_user(owner_); r := public.record_player_payment(P1, k, null, 3, null, null); r2 := public.record_player_payment(P1, k, null, 3, null, null); perform t.as_admin();
  perform t.chk('a retried save returns the same operation id', r->>'operation_id' = r2->>'operation_id' and r2->>'duplicate'='true');
  select count(*) into n from player_payment_operations where request_key=k; perform t.chk('...and only one operation row', n=1);
  perform t.as_user(owner_); r2 := public.undo_player_payment((r->>'operation_id')::uuid); perform t.as_admin();
  perform t.chk('undo works through the retried operation id', r2->>'ok'='true');
  perform t.as_user(owner_); r2 := public.record_player_payment(P1, k, null, 3, null, null); perform t.as_admin();
  perform t.chk('retrying the key after its payment was undone reports it was undone and records nothing', r2->>'duplicate'='true' and r2->>'undone'='true');
  select count(*) into n from payment_log where request_key=k; perform t.chk('...no payment row for the key', n=0);

  raise notice E'\n== Player payment permissions ==';
  perform t.as_user(parent_);
  begin r := public.record_player_payment(P2, gen_random_uuid(), null, 10, null, null); perform t.as_admin(); perform t.chk('parent cannot record', r->>'ok'<>'true');
  exception when others then perform t.as_admin(); perform t.chk('parent cannot record (error)', true); end;
  perform t.as_user(coachb); r := public.record_player_payment(P2, gen_random_uuid(), null, 10, null, null); perform t.as_admin();
  perform t.chk('another organization cannot record for this player', r->>'code'='not_found');
  perform t.as_user(coach);
  begin r := public.record_player_payment(P3, gen_random_uuid(), null, 10, null, null); perform t.as_admin(); perform t.chk('coach cannot record into a finished season', r->>'ok'<>'true');
  exception when others then perform t.as_admin(); perform t.chk('coach cannot record into a finished season (error)', true); end;
  select count(*) into n from payment_log where payment_id=P3; perform t.chk('nothing recorded for the finished season', n=0);
  perform t.as_user(owner_); r := public.record_player_payment(P2, gen_random_uuid(), null, 2, null, null); perform t.as_admin();
  op := (r->>'operation_id')::uuid;
  perform t.as_user(parent_); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('a parent cannot undo (refused)', r2->>'code' in ('forbidden','not_found'));
  perform t.as_user(coachb); r2 := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('another organization cannot undo', r2->>'code'='not_found');
  select count(*) into n from payment_log where payment_id=P2 and amount=2; perform t.chk('...the payment is still there', n=1);

  raise notice E'\n== Compatibility with the app that is live today ==';
  perform t.as_user(coach);
  insert into payment_log (payment_id, amount, paid_date, month_label) values (P2, 5, '2026-11-19', 'Nov');
  insert into budget_transactions (organization_id, season_id, budget_item_id, category, item, actual_amount, status, txn_date)
    values ('a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Tournaments','old-style insert',10,'Paid','2026-11-19');
  insert into budget_transactions (organization_id, season_id, budget_item_id, category, item, actual_amount, status, txn_date)
    values ('a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Tournaments','old-style insert 2',10,'Paid','2026-11-19');
  update payment_log set amount = 6 where payment_id=P2 and amount=5;
  delete from payment_log where payment_id=P2 and amount=6;
  perform t.as_admin();
  perform t.chk('inserts, updates and deletes without a request key still work (two identical old-style rows allowed)', true);
  perform t.chk('new columns are nullable with no default',
    (select count(*) from information_schema.columns where table_name in ('budget_transactions','payment_log') and column_name='request_key' and is_nullable='YES' and column_default is null)=2);
  perform t.chk('request_key indexes are partial (only rows with a key)',
    (select count(*) from pg_indexes where indexname in ('budget_transactions_request_key_uq','payment_log_request_key_uq') and indexdef ilike '%where (request_key is not null)%')=2);
end $$;


-- ===========================================================================
-- Fix 1: a changed cost or an edited unpaid entry is detected
-- Fix 2: clients cannot create or edit the records that authorize Undo
-- ===========================================================================
insert into tournaments (id, organization_id, season_id, name, entry_fee, gate_fee, decision, paid_status, budget_item_id) values
 ('c0000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','F1 cost',500,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-0000000000f2','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','F2 entry',450,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-0000000000f3','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','F3 entry date',450,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-0000000000f4','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','F4 entry line',450,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-0000000000f5','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','F5 swapped',450,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-0000000000f6','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','F6 clean',450,0,'Committed','Registered','e0000000-0000-0000-0000-000000000001');
insert into budget_transactions (id, organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status, txn_date) values
 ('d0000000-0000-0000-0000-0000000000f2','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f2','e0000000-0000-0000-0000-000000000001','Tournaments','F2 owed',450,'To Pay','2026-11-01'),
 ('d0000000-0000-0000-0000-0000000000f3','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f3','e0000000-0000-0000-0000-000000000001','Tournaments','F3 owed',450,'To Pay','2026-11-01'),
 ('d0000000-0000-0000-0000-0000000000f4','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f4','e0000000-0000-0000-0000-000000000001','Tournaments','F4 owed',450,'To Pay','2026-11-01'),
 ('d0000000-0000-0000-0000-0000000000f5','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f5','e0000000-0000-0000-0000-000000000001','Tournaments','F5 owed',450,'To Pay','2026-11-01'),
 ('d0000000-0000-0000-0000-0000000000f6','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f6','e0000000-0000-0000-0000-000000000001','Tournaments','F6 owed',450,'To Pay','2026-11-01');

do $$
declare
  owner_ uuid := '10000000-0000-0000-0000-000000000001'; coach uuid := '10000000-0000-0000-0000-000000000002';
  parent_ uuid := '10000000-0000-0000-0000-000000000003'; coachb uuid := '10000000-0000-0000-0000-000000000004';
  L1 uuid := 'e0000000-0000-0000-0000-000000000001'; L2 uuid := 'e0000000-0000-0000-0000-000000000002';
  F1 uuid := 'c0000000-0000-0000-0000-0000000000f1'; F2 uuid := 'c0000000-0000-0000-0000-0000000000f2';
  F3 uuid := 'c0000000-0000-0000-0000-0000000000f3'; F4 uuid := 'c0000000-0000-0000-0000-0000000000f4';
  F5 uuid := 'c0000000-0000-0000-0000-0000000000f5'; F6 uuid := 'c0000000-0000-0000-0000-0000000000f6';
  r jsonb; n int; op uuid; st text; msg text; stt text; amt numeric; sp text;
  fingerprint text;
begin
  raise notice E'\n== Fix 1: changed cost and edited unpaid entries ==';

  -- cost edited after the dialog opened (500 -> 650), payments and entries unchanged
  update tournaments set entry_fee = 650 where id = F1;
  perform t.as_user(owner_);
  r := public.mark_tournament_paid_in_full(F1, gen_random_uuid(), 'Registered', 0, 0, true, null, null, null, null, 500, '[]'::jsonb);
  perform t.as_admin();
  perform t.chk('a changed tournament cost is refused with code changed', r->>'code' = 'changed');
  perform t.chk('...nothing saved, status unchanged, no payment created',
    (select paid_status from tournaments where id=F1) = 'Registered' and (select count(*) from budget_transactions where tournament_id=F1) = 0);
  perform t.chk('...the live figures show the new cost and remaining', (r->'state'->>'total_cost')::numeric = 650 and (r->'state'->>'remaining')::numeric = 650);
  perform t.as_user(owner_);
  r := public.mark_tournament_paid_in_full(F1, gen_random_uuid(), 'Registered', 0, 0, true, null, null, null, null, 650, '[]'::jsonb);
  perform t.as_admin();
  perform t.chk('saving again with the new cost succeeds and records the new remainder (650)',
    (r->>'ok')::boolean and (r->>'recorded_amount')::numeric = 650);

  -- amount of an unpaid entry edited (count and totals of paid unchanged)
  update budget_transactions set actual_amount = 400 where id = 'd0000000-0000-0000-0000-0000000000f2';
  perform t.as_user(owner_);
  r := public.mark_tournament_paid_in_full(F2, gen_random_uuid(), 'Registered', 0, 1, true, 'd0000000-0000-0000-0000-0000000000f2', null, null, null, 450,
        jsonb_build_array(jsonb_build_object('id','d0000000-0000-0000-0000-0000000000f2','amount',450,'txn_date','2026-11-01','budget_item_id',L1)));
  perform t.as_admin();
  perform t.chk('an edited unpaid-entry AMOUNT is refused with code changed', r->>'code' = 'changed');
  perform t.chk('...the entry stays To Pay at its edited amount', (select status = 'To Pay' and actual_amount = 400 from budget_transactions where id='d0000000-0000-0000-0000-0000000000f2'));

  -- date of an unpaid entry edited
  update budget_transactions set txn_date = '2026-11-10' where id = 'd0000000-0000-0000-0000-0000000000f3';
  perform t.as_user(owner_);
  r := public.mark_tournament_paid_in_full(F3, gen_random_uuid(), 'Registered', 0, 1, true, 'd0000000-0000-0000-0000-0000000000f3', null, null, null, 450,
        jsonb_build_array(jsonb_build_object('id','d0000000-0000-0000-0000-0000000000f3','amount',450,'txn_date','2026-11-01','budget_item_id',L1)));
  perform t.as_admin();
  perform t.chk('an edited unpaid-entry DATE is refused with code changed', r->>'code' = 'changed');

  -- budget line of an unpaid entry edited
  update budget_transactions set budget_item_id = L2 where id = 'd0000000-0000-0000-0000-0000000000f4';
  perform t.as_user(owner_);
  r := public.mark_tournament_paid_in_full(F4, gen_random_uuid(), 'Registered', 0, 1, true, 'd0000000-0000-0000-0000-0000000000f4', null, null, null, 450,
        jsonb_build_array(jsonb_build_object('id','d0000000-0000-0000-0000-0000000000f4','amount',450,'txn_date','2026-11-01','budget_item_id',L1)));
  perform t.as_admin();
  perform t.chk('an edited unpaid-entry BUDGET LINE is refused with code changed', r->>'code' = 'changed');

  -- the entry was replaced by a different one (same count)
  delete from budget_transactions where id = 'd0000000-0000-0000-0000-0000000000f5';
  insert into budget_transactions (id, organization_id, season_id, tournament_id, budget_item_id, category, item, actual_amount, status, txn_date)
    values ('d0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001',F5,L1,'Tournaments','F5 replaced',450,'To Pay','2026-11-01');
  perform t.as_user(owner_);
  r := public.mark_tournament_paid_in_full(F5, gen_random_uuid(), 'Registered', 0, 1, true, null, null, null, null, 450,
        jsonb_build_array(jsonb_build_object('id','d0000000-0000-0000-0000-0000000000f5','amount',450,'txn_date','2026-11-01','budget_item_id',L1)));
  perform t.as_admin();
  perform t.chk('an unpaid entry replaced by a different one (same count, same amount) is refused', r->>'code' = 'changed');

  -- nothing changed: succeeds, with the dialog's exact figures
  perform t.as_user(owner_);
  r := public.mark_tournament_paid_in_full(F6, gen_random_uuid(), 'Registered', 0, 1, true, 'd0000000-0000-0000-0000-0000000000f6', null, null, null, 450,
        jsonb_build_array(jsonb_build_object('id','d0000000-0000-0000-0000-0000000000f6','amount',450,'txn_date','2026-11-01','budget_item_id',L1)));
  perform t.as_admin();
  perform t.chk('when nothing changed the save succeeds (amounts compare as numbers: 450 equals 450.00)', (r->>'ok')::boolean and (select status from budget_transactions where id='d0000000-0000-0000-0000-0000000000f6') = 'Paid');

  raise notice E'\n== Fix 2: operation records cannot be forged or edited by clients ==';
  select id into op from tournament_payment_operations order by created_at desc limit 1;
  perform t.chk('there is a real tournament operation to attack', op is not null);

  perform t.chk('privileges: authenticated has no INSERT/UPDATE/DELETE on either operation table',
    not has_table_privilege('authenticated','public.tournament_payment_operations','INSERT')
    and not has_table_privilege('authenticated','public.tournament_payment_operations','UPDATE')
    and not has_table_privilege('authenticated','public.tournament_payment_operations','DELETE')
    and not has_table_privilege('authenticated','public.player_payment_operations','INSERT')
    and not has_table_privilege('authenticated','public.player_payment_operations','UPDATE')
    and not has_table_privilege('authenticated','public.player_payment_operations','DELETE')
    and has_table_privilege('authenticated','public.tournament_payment_operations','SELECT'));
  perform t.chk('privileges: anon has nothing on either operation table',
    not has_table_privilege('anon','public.tournament_payment_operations','SELECT')
    and not has_table_privilege('anon','public.player_payment_operations','SELECT'));
  perform t.chk('row security is on and no write policy exists on either operation table',
    (select count(*) from pg_class where relname in ('tournament_payment_operations','player_payment_operations') and relrowsecurity) = 2
    and (select count(*) from pg_policies where tablename in ('tournament_payment_operations','player_payment_operations') and cmd <> 'SELECT') = 0);

  -- every forgery attempt, as a coach who is allowed to write payments
  foreach sp in array array['coach','owner'] loop
    perform t.as_user(case sp when 'coach' then coach else owner_ end);
    begin
      insert into tournament_payment_operations (organization_id, season_id, tournament_id, request_key, previous, after_fingerprint, result)
      values ('a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001',F6, gen_random_uuid(),
              '{"paid_status":"Not Registered"}'::jsonb, 'forged', '{}'::jsonb);
      perform t.as_admin(); perform t.chk(sp||': forging a tournament operation is refused', false);
    exception when insufficient_privilege then perform t.as_admin(); perform t.chk(sp||': forging a tournament operation is refused', true); end;
    perform t.as_user(case sp when 'coach' then coach else owner_ end);
    begin
      update tournament_payment_operations set undone_at = null, previous = '{"paid_status":"Not Registered"}'::jsonb where id = op;
      get diagnostics n = row_count; perform t.as_admin(); perform t.chk(sp||': editing a tournament operation is refused', false);
    exception when insufficient_privilege then perform t.as_admin(); perform t.chk(sp||': editing a tournament operation is refused', true); end;
    perform t.as_user(case sp when 'coach' then coach else owner_ end);
    begin
      delete from tournament_payment_operations where id = op;
      perform t.as_admin(); perform t.chk(sp||': deleting a tournament operation is refused', false);
    exception when insufficient_privilege then perform t.as_admin(); perform t.chk(sp||': deleting a tournament operation is refused', true); end;
  end loop;
  perform t.chk('the tournament operation row is unchanged after the attempts', (select undone_at is null and previous->>'paid_status' = 'Registered' from tournament_payment_operations where id = op));

  -- player operations
  insert into player_payments (id, organization_id, season_id, player_name, initial_cost)
    values ('f0000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','Forgery Player',1000);
  perform t.as_user(coach);
  r := public.record_player_payment('f0000000-0000-0000-0000-0000000000f1', gen_random_uuid(), 0, 100, '2026-11-19', 'Nov');
  perform t.as_admin();
  perform t.chk('a real player payment is recorded through the function', (r->>'ok')::boolean);
  op := (r->>'operation_id')::uuid;
  foreach sp in array array['coach','owner'] loop
    perform t.as_user(case sp when 'coach' then coach else owner_ end);
    begin
      insert into player_payment_operations (organization_id, season_id, payment_id, request_key, entry_id, amount, after_fingerprint)
      values ('a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-0000000000f1', gen_random_uuid(), gen_random_uuid(), 1, 'forged');
      perform t.as_admin(); perform t.chk(sp||': forging a player-payment operation is refused', false);
    exception when insufficient_privilege then perform t.as_admin(); perform t.chk(sp||': forging a player-payment operation is refused', true); end;
    perform t.as_user(case sp when 'coach' then coach else owner_ end);
    begin
      update player_payment_operations set undone_at = null, after_fingerprint = 'x' where id = op;
      perform t.as_admin(); perform t.chk(sp||': editing a player-payment operation is refused', false);
    exception when insufficient_privilege then perform t.as_admin(); perform t.chk(sp||': editing a player-payment operation is refused', true); end;
    perform t.as_user(case sp when 'coach' then coach else owner_ end);
    begin
      delete from player_payment_operations where id = op;
      perform t.as_admin(); perform t.chk(sp||': deleting a player-payment operation is refused', false);
    exception when insufficient_privilege then perform t.as_admin(); perform t.chk(sp||': deleting a player-payment operation is refused', true); end;
  end loop;

  -- the forged-undo path the old design allowed: craft an operation pointing at someone else's payment, then undo it
  perform t.chk('the legitimate operations still exist after all attempts', (select count(*) from player_payment_operations where id = op) = 1);

  raise notice E'\n== Fix 2: the writers still refuse people who may not write ==';
  perform t.as_user(parent_);
  r := public.record_player_payment('f0000000-0000-0000-0000-0000000000f1', gen_random_uuid(), 100, 5, null, null);
  perform t.as_admin();
  perform t.chk('a parent cannot record a payment (forbidden)', r->>'code' = 'forbidden');
  perform t.as_user(coachb);
  r := public.record_player_payment('f0000000-0000-0000-0000-0000000000f1', gen_random_uuid(), 100, 5, null, null);
  perform t.as_admin();
  perform t.chk('another organization cannot record a payment (not_found, existence not revealed)', r->>'code' = 'not_found');
  perform t.as_user(parent_);
  r := public.mark_tournament_paid_in_full('c0000000-0000-0000-0000-0000000000f6', gen_random_uuid(), 'Paid in Full', 0, 0, false, null, null, null, null, 450, '[]'::jsonb);
  perform t.as_admin();
  perform t.chk('a parent cannot mark a tournament paid (forbidden)', r->>'code' = 'forbidden');
  perform t.as_user(coachb);
  r := public.mark_tournament_paid_in_full('c0000000-0000-0000-0000-0000000000f6', gen_random_uuid(), 'Paid in Full', 0, 0, false, null, null, null, null, 450, '[]'::jsonb);
  perform t.as_admin();
  perform t.chk('another organization cannot mark a tournament paid (not_found)', r->>'code' = 'not_found');
  perform t.as_user(parent_); r := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('a parent cannot undo (not_found: cannot see the operation)', r->>'code' in ('not_found','forbidden'));
  perform t.as_user(coachb); r := public.undo_player_payment(op); perform t.as_admin();
  perform t.chk('another organization cannot undo (not_found)', r->>'code' = 'not_found');
  perform t.chk('nothing was changed by the refused calls',
    (select count(*) from payment_log where payment_id = 'f0000000-0000-0000-0000-0000000000f1') = 1
    and (select paid_status from tournaments where id = 'c0000000-0000-0000-0000-0000000000f6') = 'Paid in Full');
  perform t.as_user(parent_);
  perform t.chk('a parent still cannot read the operation tables',
    (select count(*) from tournament_payment_operations) = 0 and (select count(*) from player_payment_operations) = 0);
  perform t.as_admin();
  perform t.chk('the writers are the only security definer functions, and they pin search_path',
    (select string_agg(proname, ',' order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and prosecdef and proname in ('tournament_money_state','tournament_payment_fingerprint','player_payment_fingerprint',
        'mark_tournament_paid_in_full','undo_mark_tournament_paid_in_full','record_player_payment','undo_player_payment'))
      = 'mark_tournament_paid_in_full,record_player_payment,undo_mark_tournament_paid_in_full,undo_player_payment'
    and (select count(*) from pg_proc p where proname in ('mark_tournament_paid_in_full','undo_mark_tournament_paid_in_full','record_player_payment','undo_player_payment')
          and proconfig::text ilike '%search_path=public%') = 4);
end $$;


-- ===========================================================================
-- Elevated functions: fixed search path, restricted execution, explicit checks
-- ===========================================================================
do $$
declare
  coach uuid := '10000000-0000-0000-0000-000000000002';
  F6 uuid := 'c0000000-0000-0000-0000-0000000000f6';
  r jsonb; w text;
begin
  raise notice E'\n== Elevated functions: search path, execute rights, shadowing ==';
  perform t.as_admin();
  foreach w in array array['mark_tournament_paid_in_full','undo_mark_tournament_paid_in_full','record_player_payment','undo_player_payment'] loop
    perform t.chk(w||': security definer with search_path = public, pg_temp (pg_temp last)',
      (select prosecdef and proconfig::text like '%search_path=public, pg_temp%' from pg_proc where pronamespace='public'::regnamespace and proname = w));
    perform t.chk(w||': not executable by anon or PUBLIC, executable by signed-in users',
      (select not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('public', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute')
         from pg_proc where pronamespace='public'::regnamespace and proname = w));
  end loop;
  perform t.chk('every function this release adds pins a search path that ends in pg_temp',
    (select count(*) from pg_proc where pronamespace='public'::regnamespace
        and proname in ('mark_tournament_paid_in_full','undo_mark_tournament_paid_in_full','record_player_payment','undo_player_payment','tournament_money_state','tournament_payment_fingerprint','player_payment_fingerprint')
        and proconfig::text like '%search_path=public, pg_temp%') = 7);

  -- A temp table named like a real table must not be picked up by the elevated code.
  perform t.as_user(coach);
  create temp table tournaments (id uuid, season_id uuid, organization_id uuid, paid_status text, total_cost numeric) on commit drop;
  insert into pg_temp.tournaments values (F6, '5a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Registered', 1);
  create temp table budget_transactions (id uuid) on commit drop;
  r := public.mark_tournament_paid_in_full(F6, gen_random_uuid(), 'Paid in Full', 0, 0, false, null, null, null, null, 450, '[]'::jsonb);
  perform t.as_admin();
  perform t.chk('a temp table named like a real table is ignored (belt and braces: the code also schema-qualifies every table)', r->>'code' = 'already_paid');
end $$;

select format('%s passed, %s failed', count(*) filter (where ok), count(*) filter (where not ok)) as summary from t.results;
select name from t.results where not ok;
