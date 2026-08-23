-- Quantity-based budget lines: a coach budgeting 16 jerseys at $120 should
-- not have to multiply in Excel first.
--
-- Both nullable, and `budgeted` is deliberately untouched. It is read in 19
-- places — category rollups, remaining, % used, income targets, the Finance
-- summary and the Home dashboard — and every one reads a single number.
-- Deriving the total at read time would mean changing all of them; computing
-- it on save changes none.
--
-- A lump-sum line keeps both columns null and behaves exactly as before, so
-- the 36 existing rows need no backfill.

alter table budget_items
  add column quantity  numeric(10, 2),
  add column unit_cost numeric(12, 2);

comment on column budget_items.quantity is
  'Quantity mode only. Always entered by the coach — never derived from roster
   size, because a 15-player roster may legitimately need 16 jerseys, spares or
   coach gear. Numeric rather than integer: cases of water and days of field
   rental are not whole units.';

comment on column budget_items.unit_cost is
  'Quantity mode only. budgeted is stored as quantity * unit_cost at save time.';

comment on column budget_items.budgeted is
  'The planned total, always. In quantity mode it is calculated on save; in
   total-amount mode it is entered directly. Every Finance calculation reads
   this column and nothing else.';
