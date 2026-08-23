-- A CHECK constraint cannot express this: CURRENT_DATE is not immutable, so
-- Postgres rejects it in a check. A trigger is the only way to enforce it in
-- the database, and enforcing it in the database matters because application
-- code can be bypassed.
create or replace function public.enforce_game_result_timing()
returns trigger language plpgsql as $$
begin
  -- A game in the future has not been played, so it cannot have an outcome.
  -- Uses > rather than >= so same-day results can be entered as you play.
  if new.game_date > current_date then
    if new.result is not null
       or new.runs_for is not null
       or new.runs_against is not null then
      raise exception
        'Game against % is scheduled for % and cannot have a result or score yet.',
        coalesce(new.opponent_name, 'opponent'), to_char(new.game_date, 'Mon DD, YYYY')
        using errcode = 'check_violation';
    end if;
  end if;

  -- A partial score is not a score.
  if (new.runs_for is null) <> (new.runs_against is null) then
    raise exception 'Enter both scores or neither.'
      using errcode = 'check_violation';
  end if;

  -- Scores are the source of truth. When both are present the result is
  -- derived rather than trusted, so a 'W' can never sit beside a losing
  -- scoreline.
  if new.runs_for is not null and new.runs_against is not null then
    new.result := case
      when new.runs_for > new.runs_against then 'W'
      when new.runs_for < new.runs_against then 'L'
      else 'T'
    end;
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_game_result_timing on games;
create trigger trg_enforce_game_result_timing
  before insert or update on games
  for each row execute function public.enforce_game_result_timing();

comment on function public.enforce_game_result_timing() is
  'Blocks results/scores on future-dated games, rejects half-entered scores, and
   derives result from the score. The UI intercepts the future-date edit case
   first and asks the user to confirm clearing a recorded result — the trigger
   is the backstop, not the user experience.';
