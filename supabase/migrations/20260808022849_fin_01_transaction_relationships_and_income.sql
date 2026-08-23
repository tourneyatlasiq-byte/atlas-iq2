-- Income must be classifiable on the transaction itself, because an unlinked
-- transaction has no budget line to inherit from.
alter table budget_transactions
  add column if not exists is_income boolean not null default false;

-- A transaction belongs to a specific budget line. When linked, the budget
-- item is the source of truth for category.
alter table budget_transactions
  add column if not exists budget_item_id uuid references budget_items(id) on delete set null;

-- Optional relationships.
alter table budget_transactions
  add column if not exists player_id uuid references players(id) on delete set null;
alter table budget_transactions
  add column if not exists facility_id uuid references facilities(id) on delete set null;

create index if not exists idx_budget_txn_budget_item on budget_transactions (budget_item_id);
create index if not exists idx_budget_txn_player on budget_transactions (player_id);
create index if not exists idx_budget_txn_facility on budget_transactions (facility_id);
create index if not exists idx_budget_txn_tournament on budget_transactions (tournament_id);
create index if not exists idx_budget_items_org_season on budget_items (organization_id, season_id);

comment on column budget_items.actual is
  'LEGACY. Hand-maintained actual spend, retained for the pre-Atlas Georgia Power data.
   The Finance module never writes to this column — actual spend is derived from
   linked budget_transactions.';

comment on column budget_transactions.category is
  'FALLBACK ONLY. When budget_item_id is set, the linked budget item''s category is
   authoritative and this column is ignored. Used only for unlinked transactions.';

comment on column budget_transactions.is_income is
  'True for realized income (fundraising, sponsors, concessions). Kept explicit rather
   than inferred from the budget line so unlinked transactions remain classifiable.';

comment on column budget_transactions.actual_amount is
  'The actual transaction amount. Counts toward Actual reporting only when non-null
   AND status = ''Paid''. Ordered/Received with an amount are reported separately as
   committed-but-unpaid.';

comment on column budget_transactions.budgeted_amount is
  'LEGACY. Budget planning lives in budget_items.budgeted. Not used by the Finance module.';
