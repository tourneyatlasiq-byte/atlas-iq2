-- budget_items previously had no season_id, so budgets could not be separated
-- historically. Table is empty, so this is a clean correction.
--
-- Modeling note: `category` here is a plain text label, NOT a reusable
-- template entity. A future budget_categories table can be introduced and
-- referenced by FK without disturbing these rows. Naming stays deliberate:
-- budget_items = the budgeted amount FOR A SPECIFIC SEASON.

alter table budget_items
  add column if not exists season_id uuid references seasons(id) on delete cascade;

create index if not exists idx_budget_items_season on budget_items (season_id);

comment on table budget_items is
  'Season-specific budget allocations. `category` is a free-text label; a reusable
   budget_categories entity can be added later and referenced by FK.';

comment on column budget_items.season_id is
  'Authoritative scope. Season -> Team -> Organization. Null means an
   organization-level item not tied to a season.';
