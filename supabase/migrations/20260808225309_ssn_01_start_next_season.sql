-- Creating next season is several writes that must succeed or fail together:
-- a half-created season with a partial roster is worse than none.
--
-- Deliberately does NOT set is_current. Creating a season and advancing the
-- team into it are separate decisions — a coach planning 2027-28 in March
-- should not lose their 2026-27 working context.

create or replace function public.start_next_season(
  p_team_id uuid,
  p_season_name text,
  p_player_ids uuid[],
  p_copy_budget boolean default false
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_name text := nullif(btrim(p_season_name), '');
  v_source uuid;
  v_new uuid;
  v_start date;
  v_year int;
  v_players int := 0;
  v_lines int := 0;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  if not auth_is_org_admin() then
    raise exception 'Only an owner or admin can start a new season.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_name is null then
    raise exception 'Enter a name for the new season.';
  end if;

  -- The team must belong to the caller's organization. Checked explicitly
  -- because SECURITY DEFINER bypasses RLS.
  select organization_id into v_org from teams where id = p_team_id;

  if v_org is null or v_org is distinct from auth_organization_id() then
    raise exception 'That team could not be found.' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from seasons where team_id = p_team_id and lower(btrim(name)) = lower(v_name)) then
    raise exception 'This team already has a season called %.', v_name
      using errcode = 'unique_violation';
  end if;

  -- Source season for roster and budget: the current one, else the newest.
  select id into v_source from seasons
   where team_id = p_team_id and is_current = true limit 1;
  if v_source is null then
    select id into v_source from seasons where team_id = p_team_id
     order by coalesce(start_date, created_at::date) desc limit 1;
  end if;

  -- Derive a start date from names like "2027-28" so past and future can be
  -- told apart without relying on creation order.
  v_year := substring(v_name from '^(\d{4})')::int;
  if v_year is not null then
    v_start := make_date(v_year, 8, 1);
  end if;

  insert into seasons (team_id, name, start_date, is_current, is_placeholder)
  values (p_team_id, v_name, v_start, false, false)
  returning id into v_new;

  -- Carry the selected people over, keeping jersey and sizing from their most
  -- recent assignment on this team. Player records are reused, never copied —
  -- a player is a person, not a season row.
  if p_player_ids is not null and array_length(p_player_ids, 1) > 0 then
    insert into team_season_players
      (player_id, team_id, season_id, jersey_number, jersey_size, pants_size, positions, is_active)
    select distinct on (prev.player_id)
      prev.player_id, p_team_id, v_new,
      prev.jersey_number, prev.jersey_size, prev.pants_size, prev.positions, true
    from team_season_players prev
    join seasons s on s.id = prev.season_id
    where s.team_id = p_team_id
      and prev.player_id = any (p_player_ids)
    order by prev.player_id, coalesce(s.start_date, s.created_at::date) desc;

    get diagnostics v_players = row_count;
  end if;

  -- Structure only. Amounts start at zero: a pre-filled figure from last year
  -- is more likely to be accepted than checked.
  if p_copy_budget and v_source is not null then
    insert into budget_items (organization_id, season_id, category, name, budgeted, is_income)
    select v_org, v_new, category, name, 0, is_income
    from budget_items where season_id = v_source;

    get diagnostics v_lines = row_count;
  end if;

  return json_build_object(
    'season_id', v_new,
    'team_id', p_team_id,
    'name', v_name,
    'start_date', v_start,
    'players_copied', v_players,
    'budget_lines_copied', v_lines
  );
end;
$$;

comment on function public.start_next_season(uuid, text, uuid[], boolean) is
  'Creates the next season for a team and carries over selected roster members,
   optionally the budget structure with zero amounts. Admin only, own
   organization only. Leaves is_current untouched — advancing the team is a
   separate, explicit action via set_current_season().';

revoke all on function public.start_next_season(uuid, text, uuid[], boolean) from public;
grant execute on function public.start_next_season(uuid, text, uuid[], boolean) to authenticated;
