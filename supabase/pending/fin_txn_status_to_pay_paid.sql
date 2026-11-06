-- Transaction statuses: Planned | Ordered | Received | Paid  ->  To Pay | Paid
--
-- PENDING. Not applied. Moves to supabase/migrations/ under the version
-- Supabase records once it has been applied through the MCP tool.
--
-- Why. Ordered and Received were identical in every Finance calculation (both
-- "committed, not yet paid"), and Planned counted toward nothing: planning
-- already lives on budget lines and on tournament decisions. Two statuses
-- remain, named for the two figures they feed:
--
--   To Pay  counts toward Total Committed and To Pay, reduces Available,
--           never counts as Paid. (Exactly what Ordered and Received did.)
--   Paid    unchanged: counts as Paid, inside Total Committed.
--
-- Income transactions no longer carry a meaningful status; the application
-- always records them as Paid.
--
-- Mapping, chosen so no Finance figure can move:
--   Ordered  -> To Pay
--   Received -> To Pay
--   Paid     -> Paid
--   Planned  -> To Pay, ONLY when it has no amount. A row with no amount
--               counts toward nothing under either status, so this is
--               financially inert. A Planned row WITH an amount would become a
--               new commitment, so the migration refuses to run if one exists
--               and that row is decided on first.
--
-- Guards (any failure raises and the whole migration rolls back):
--   1. no status outside the four known values
--   2. no Planned row carries an amount
--   3. no income row is anything but Paid
--   4. every non-status column is byte-identical afterwards (row fingerprint)
--   5. the money each status contributes, per season, budget line, tournament
--      and income/expense, is identical afterwards (financial fingerprint).
--      Every Finance figure (Paid, To Pay, Available, Total Committed,
--      Projected Available, tournament commitments, Money In) is derived from
--      those per-group sums, so equal sums prove equal figures.
--   6. exactly the expected number of rows changed status, and Paid is untouched
--
-- Does not touch: budget_items, tournaments, player_payments, payment_log,
-- RLS policies, the season write-policy trigger or any other table.

do $$
declare
  n_unknown int;
  n_planned_with_amount int;
  n_income_not_paid int;
  n_total_before int;
  n_paid_before int;
  n_to_change int;
  n_changed int;
  n_total_after int;
  n_paid_after int;
  n_to_pay_after int;
  rows_before text;
  rows_after text;
  money_before text;
  money_after text;
begin
  -- Guard 1
  select count(*) into n_unknown from public.budget_transactions
   where status not in ('Planned', 'Ordered', 'Received', 'Paid');
  if n_unknown > 0 then
    raise exception 'Aborted: % transaction(s) have an unrecognised status.', n_unknown;
  end if;

  -- Guard 2
  select count(*) into n_planned_with_amount from public.budget_transactions
   where status = 'Planned' and actual_amount is not null;
  if n_planned_with_amount > 0 then
    raise exception 'Aborted: % Planned transaction(s) carry an amount. Moving them to To Pay would create a new commitment; decide their treatment first.', n_planned_with_amount;
  end if;

  -- Guard 3
  select count(*) into n_income_not_paid from public.budget_transactions
   where is_income and status <> 'Paid';
  if n_income_not_paid > 0 then
    raise exception 'Aborted: % income transaction(s) are not Paid. Income no longer has a status; decide their treatment first.', n_income_not_paid;
  end if;

  select count(*), count(*) filter (where status = 'Paid'),
         count(*) filter (where status in ('Planned', 'Ordered', 'Received'))
    into n_total_before, n_paid_before, n_to_change
    from public.budget_transactions;

  -- Everything except status, per row.
  select md5(coalesce(string_agg((id, organization_id, season_id, budget_item_id,
           tournament_id, player_id, facility_id, is_income, actual_amount, budgeted_amount,
           quantity, category, txn_date, vendor, item, receipt_path, notes, created_at)::text, '#' order by id), ''))
    into rows_before from public.budget_transactions;

  -- Money by financial role, old vocabulary.
  select md5(coalesce(string_agg(g, '#' order by g), '')) into money_before from (
    select (season_id, budget_item_id, tournament_id, is_income,
             coalesce(sum(actual_amount) filter (where actual_amount is not null and status = 'Paid'), 0),
             coalesce(sum(actual_amount) filter (where actual_amount is not null and status in ('Ordered', 'Received')), 0),
             count(*) filter (where actual_amount is not null and status = 'Paid'),
             count(*) filter (where actual_amount is not null and status in ('Ordered', 'Received')))::text as g
      from public.budget_transactions
     group by season_id, budget_item_id, tournament_id, is_income
  ) t;

  -- The change.
  alter table public.budget_transactions drop constraint budget_transactions_status_check;

  update public.budget_transactions
     set status = 'To Pay'
   where status in ('Ordered', 'Received')
      or (status = 'Planned' and actual_amount is null);
  get diagnostics n_changed = row_count;

  alter table public.budget_transactions
    add constraint budget_transactions_status_check check (status in ('To Pay', 'Paid'));
  alter table public.budget_transactions alter column status set default 'Paid';

  -- Guard 6
  select count(*), count(*) filter (where status = 'Paid'), count(*) filter (where status = 'To Pay')
    into n_total_after, n_paid_after, n_to_pay_after
    from public.budget_transactions;
  if n_changed <> n_to_change or n_total_after <> n_total_before
     or n_paid_after <> n_paid_before or n_to_pay_after <> n_to_change then
    raise exception 'Aborted: row counts moved (changed % of %, total % -> %, Paid % -> %, To Pay %).',
      n_changed, n_to_change, n_total_before, n_total_after, n_paid_before, n_paid_after, n_to_pay_after;
  end if;

  -- Guard 4
  select md5(coalesce(string_agg((id, organization_id, season_id, budget_item_id,
           tournament_id, player_id, facility_id, is_income, actual_amount, budgeted_amount,
           quantity, category, txn_date, vendor, item, receipt_path, notes, created_at)::text, '#' order by id), ''))
    into rows_after from public.budget_transactions;
  if rows_after <> rows_before then
    raise exception 'Aborted: a column other than status changed.';
  end if;

  -- Guard 5, new vocabulary.
  select md5(coalesce(string_agg(g, '#' order by g), '')) into money_after from (
    select (season_id, budget_item_id, tournament_id, is_income,
             coalesce(sum(actual_amount) filter (where actual_amount is not null and status = 'Paid'), 0),
             coalesce(sum(actual_amount) filter (where actual_amount is not null and status = 'To Pay'), 0),
             count(*) filter (where actual_amount is not null and status = 'Paid'),
             count(*) filter (where actual_amount is not null and status = 'To Pay'))::text as g
      from public.budget_transactions
     group by season_id, budget_item_id, tournament_id, is_income
  ) t;
  if money_after <> money_before then
    raise exception 'Aborted: the money attributed to Paid or To Pay changed (% -> %).', money_before, money_after;
  end if;

  raise notice 'Transaction statuses migrated: % row(s) to To Pay, % Paid unchanged, financial fingerprint %.',
    n_changed, n_paid_after, money_after;
end
$$;

comment on column public.budget_transactions.status is
  'To Pay: committed, not yet paid (counts toward Total Committed and To Pay, reduces Available). '
  'Paid: money has left the account (counts as Paid, inside Total Committed). '
  'Income transactions are always Paid. An amount is required for either to count.';

comment on column public.budget_transactions.actual_amount is
  'The transaction amount. Counts only when non-null. Status decides its meaning: '
  'Paid = actual spend (or income received); To Pay = committed but not yet paid.';
