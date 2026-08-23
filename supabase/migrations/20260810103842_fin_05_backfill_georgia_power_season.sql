-- 19 budget lines worth $32,948 carried season_id = NULL and were therefore
-- invisible to every Finance screen — the organization saw $0 planned while
-- holding a full season budget.
--
-- The season is not a guess: all 19 rows belong to one organization, were
-- created on one day, have zero linked transactions, and that organization has
-- exactly one season. One row is named "25-26 Tournaments / Gates (season
-- total)", which names the season outright.
--
-- Scoped to that organization and to NULL rows only. No other organization,
-- season, transaction or payment is touched.

update budget_items
   set season_id = '2139671b-0dfd-4d1f-9f94-473f486b185c'
 where season_id is null
   and organization_id = '00000000-0000-0000-0000-000000000001';
