-- "Season tournament entries" ($4,500) and "Gate fees" ($600) were demo seed
-- data that now duplicate the real "All Tournaments" ($22,000) budget line.
--
-- Three genuine transactions worth $1,130 are linked to them. Relink first:
-- deleting the lines would set budget_item_id to null (ON DELETE SET NULL),
-- silently dropping that spend out of category reporting and into the
-- "unlinked transactions" bucket. The money is real and belongs against the
-- tournament budget.
update budget_transactions
set budget_item_id = (
  select id from budget_items
   where season_id = 'a71a5000-0000-0000-0000-000000000003'
     and category = 'Tournament Fees'
     and name = 'All Tournaments'
)
where budget_item_id in (
  'a71a5000-0000-0000-0000-000000000901',
  'a71a5000-0000-0000-0000-000000000902'
);

delete from budget_items
where id in (
  'a71a5000-0000-0000-0000-000000000901',
  'a71a5000-0000-0000-0000-000000000902'
);
