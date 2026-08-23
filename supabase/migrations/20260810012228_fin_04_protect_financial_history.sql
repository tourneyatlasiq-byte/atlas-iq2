-- P0: payment history must survive the removal of its obligation.
--
-- payment_log.payment_id was ON DELETE CASCADE, so deleting one dues
-- obligation destroyed $2,400 of recorded payments in testing. Money that a
-- family actually handed over must never disappear because a container record
-- was removed.

alter table payment_log
  drop constraint payment_log_payment_id_fkey;

alter table payment_log
  add constraint payment_log_payment_id_fkey
  foreign key (payment_id) references player_payments(id) on delete restrict;

comment on constraint payment_log_payment_id_fkey on payment_log is
  'RESTRICT, not CASCADE. Recorded payments are financial history; an
   obligation with payments must be adjusted, never deleted.';

-- P1: a transaction must not silently lose its budget line.
--
-- ON DELETE SET NULL orphaned transactions, which then counted in the Finance
-- summary while vanishing from category totals — the two views disagreed with
-- nothing to explain it. The application already refuses this; the database
-- now agrees.

alter table budget_transactions
  drop constraint budget_transactions_budget_item_id_fkey;

alter table budget_transactions
  add constraint budget_transactions_budget_item_id_fkey
  foreign key (budget_item_id) references budget_items(id) on delete restrict;

comment on constraint budget_transactions_budget_item_id_fkey on budget_transactions is
  'RESTRICT so a budget line with transactions cannot be deleted until they are
   reassigned. Matches deleteBudgetItem, which offers a move-to path.';
