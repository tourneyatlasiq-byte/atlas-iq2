-- runs_for and runs_against defaulted to 0, so an unplayed game arrived as a
-- 0-0 scoreline. Two consequences:
--
--   1. The timing trigger rejected every future game, because the defaults made
--      it look like a result had been entered.
--   2. "No score recorded" and "scoreless tie" were indistinguishable.
--
-- Null is the correct absence value. A genuine 0-0 tie is still enterable
-- explicitly.
alter table games alter column runs_for drop default;
alter table games alter column runs_against drop default;

-- Existing 0-0 rows on unplayed games are the default leaking through, not
-- recorded scores. Only touch future-dated games so real results are untouched.
update games
set runs_for = null, runs_against = null, result = null
where game_date > current_date
  and coalesce(runs_for, 0) = 0
  and coalesce(runs_against, 0) = 0;

comment on column games.runs_for is
  'Null means no score recorded. Deliberately not defaulted to 0, which would be
   indistinguishable from a scoreless tie.';
