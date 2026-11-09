-- qab_one_reason — one primary QAB reason per plate appearance (2026-11).
--
-- PENDING. Not applied. Moves to supabase/migrations/ under the version
-- Supabase records when it is applied.
--
-- Product rule: a plate appearance is not a QAB (no reason) or a QAB with
-- exactly one reason, the coach's primary reason. The application enforces
-- this already (lib/qab-rules.js validateReasons, in both plate-appearance
-- server actions, deployed in 630bbbb); this makes the database say the same,
-- for every write path.
--
-- The qab_reasons array column is kept. is_qab (cardinality > 0),
-- pa_reasons_allowed, trg_normalize_qab_reasons, idx_pa_reasons and the
-- qab_* views are unchanged.
--
-- Preconditions, verified 2026-11-09: zero rows with more than one reason
-- (the single legacy Northgate row was reduced to Hit by a guarded update
-- before this file was written). The table holds a few hundred rows, so the
-- constraint is added and validated in one statement.
--
-- The application maps a violation of this constraint (23514, pa_one_reason)
-- to: "Choose one QAB reason. A plate appearance can have only one primary
-- reason."

alter table public.plate_appearances
  add constraint pa_one_reason check (cardinality(qab_reasons) <= 1);
