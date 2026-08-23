-- One dues obligation per player per season.
--
-- Nothing enforced this. The only guard was a filter in the dues form that
-- hides players who already have a record — a UI convention, not a rule. Two
-- obligations for one player would double-count dues expected and collected,
-- because listPlayerPayments aggregates by season without deduplicating.
--
-- Partial index: player_id is nullable and six legacy rows carry a name only.
-- Those predate player linking and must not block the constraint.

create unique index player_payments_one_per_player_season
  on player_payments (player_id, season_id)
  where player_id is not null;

comment on index player_payments_one_per_player_season is
  'A player owes one amount per season. Excludes legacy rows where player_id
   was never populated.';
