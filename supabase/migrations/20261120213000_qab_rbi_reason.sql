-- qab_rbi_reason: add RBI as a ninth QAB reason (2026-11).
--
-- Apply this BEFORE deploying the application code in the same package (see
-- docs/qab-rbi-release-runbook.md). Not applied at the time of writing.
--
-- Product decision (a coach confirmed): RBI is its own primary reason, chosen
-- by the coach. The one-reason rule is unchanged (pa_one_reason stays), so an
-- at-bat that is both a hit and an RBI is recorded under ONE of them, never
-- both. No RBI count column and no RBI statistic is introduced.
--
-- What changes: ONE constraint. pa_reasons_allowed (verified against
-- production 2026-11-20 as an array of the eight original keys) is replaced by
-- the same list plus 'rbi'. Nothing else needs to change:
--   - is_qab (cardinality(qab_reasons) > 0)        unchanged
--   - pa_one_reason (cardinality <= 1)             unchanged
--   - trg_normalize_qab_reasons / idx_pa_reasons   unchanged
--   - qab_reason_tournament and the other qab_* views group by whatever key is
--     stored (unnest), with no reason list inside, so 'rbi' flows through
--   - existing rows: untouched. No Hit or Situational success row is relabelled.
--
-- Order of operations (important): apply this BEFORE the application code that
-- offers RBI is deployed. The change only widens what is allowed, so the
-- currently deployed code keeps working before and after it is applied.
--
-- Cost and locking: the table holds a few hundred rows, so dropping and
-- re-adding the check (which re-validates every row against the wider list)
-- takes a brief ACCESS EXCLUSIVE lock and finishes in well under a second.
-- Both steps run in one statement, so there is no moment without a constraint.
--
-- Rollback: restore the eight-key constraint. That statement FAILS if any row
-- already stores 'rbi'; those rows would have to be re-recorded by a coach
-- first. Rolling the application back after RBI has been recorded would also
-- leave RBI at-bats counted as QAB but missing from reason totals, so prefer
-- fixing forward.

alter table public.plate_appearances
  drop constraint pa_reasons_allowed,
  add constraint pa_reasons_allowed check (
    qab_reasons <@ array[
      'hit','walk','hbp','hard_hit','eight_pitch',
      'situation_success','sac_bunt','sac_fly','rbi'
    ]::text[]
  );
