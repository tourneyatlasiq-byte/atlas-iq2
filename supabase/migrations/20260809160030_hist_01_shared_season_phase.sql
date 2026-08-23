-- One definition of season phase for the whole database.
--
-- Previously this logic lived inside enforce_participant_integrity() and was
-- about to be copied into six more triggers. Mirrors seasonPhase() in
-- lib/context.js; if one changes, both must.
--
-- Ambiguity deliberately fails OPEN (writable). Wrongly locking a season blocks
-- legitimate work with a confusing error; wrongly leaving one writable only
-- preserves the behaviour Atlas has had all along.

create or replace function public.atlas_season_phase(p_season_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  s_current boolean;
  s_team uuid;
  s_key date;
  cur_key date;
begin
  select is_current, team_id, coalesce(start_date, created_at::date)
    into s_current, s_team, s_key
    from seasons where id = p_season_id;

  -- Unknown season: not our decision to make here. Other checks handle it.
  if s_team is null then
    return 'current';
  end if;

  -- The flag is authoritative and short-circuits the date comparison. This is
  -- why the one season with no start_date cannot be misclassified.
  if s_current then
    return 'current';
  end if;

  select coalesce(cs.start_date, cs.created_at::date) into cur_key
    from seasons cs where cs.team_id = s_team and cs.is_current limit 1;

  -- A team with no current season has no reference point.
  if cur_key is null then
    return 'current';
  end if;

  -- Strictly earlier is past. Equal keys — two seasons created the same day
  -- with no start_date — resolve to future, so an ambiguous season stays
  -- writable rather than being silently locked.
  if s_key < cur_key then
    return 'past';
  end if;

  return 'future';
end;
$$;

comment on function public.atlas_season_phase(uuid) is
  'Single source of season phase: current | future | past. is_current is
   authoritative; date comparison only decides between past and future.
   Ambiguity resolves to future so a season is never wrongly locked.';

revoke all on function public.atlas_season_phase(uuid) from public;
grant execute on function public.atlas_season_phase(uuid) to authenticated;
