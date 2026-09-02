-- ST-007: a budget line referenced by a tournament must not be silently
-- deletable in a way that clears the tournament's budget assignment.
-- ON DELETE SET NULL let a budget-line delete pass with no warning whenever
-- the linked tournament had no transaction filed against it yet (the normal
-- state for a Committed event nobody has paid toward). Matches the existing
-- ON DELETE RESTRICT already in place on budget_transactions_budget_item_id_fkey
-- for the same reason -- tournaments was the outlier, not the norm.
--
-- Compatibility re-checked immediately before this migration: 0 tournaments
-- reference a budget_items row that doesn't exist, so the new constraint
-- validates against current data with no changes required.
--
-- This is defense-in-depth alongside the application-level check added in
-- lib/actions/finance.js (deleteBudgetItem) and components/FinanceClient.js
-- (BudgetSection) in the same deployment -- the app check produces a named,
-- actionable error for a coach; this constraint is the backstop for any
-- write path that bypasses the app.
ALTER TABLE tournaments
  DROP CONSTRAINT tournaments_budget_item_id_fkey,
  ADD CONSTRAINT tournaments_budget_item_id_fkey
    FOREIGN KEY (budget_item_id) REFERENCES budget_items(id) ON DELETE RESTRICT;
