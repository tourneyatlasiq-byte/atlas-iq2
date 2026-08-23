-- Switching the current season is two writes, and the partial unique index
-- idx_seasons_one_current_per_team rejects a moment where two rows are current.
-- Doing this from the client risks a team ending up with none.
--
-- One function, one transaction: clear, then set. Built now so the future
-- Settings UI calls it rather than reinventing the sequence.

create or replace function public.set_current_season(p_season_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_team uuid;
  v_org uuid;
  v_name text;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  -- Admin-only, matching the seasons write policy.
  if not auth_is_org_admin() then
    raise exception 'Only an owner or admin can change the current season.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The season must belong to a team in the caller's own organization.
  -- Checked explicitly because SECURITY DEFINER bypasses RLS.
  select s.team_id, t.organization_id, s.name
    into v_team, v_org, v_name
  from seasons s
  join teams t on t.id = s.team_id
  where s.id = p_season_id;

  if v_team is null then
    raise exception 'That season could not be found.' using errcode = 'insufficient_privilege';
  end if;

  if v_org is distinct from auth_organization_id() then
    raise exception 'That season belongs to another organization.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Clear then set, in that order. The reverse violates the unique index.
  update seasons set is_current = false
   where team_id = v_team and is_current = true and id <> p_season_id;

  update seasons set is_current = true where id = p_season_id;

  return json_build_object('season_id', p_season_id, 'team_id', v_team, 'name', v_name);
end;
$$;

comment on function public.set_current_season(uuid) is
  'Switches a team''s current season atomically. Admin only, own organization
   only. Clears the existing current season before setting the new one, so the
   one-current-per-team index can never be violated and a team is never left
   without a current season.';

revoke all on function public.set_current_season(uuid) from public;
grant execute on function public.set_current_season(uuid) to authenticated;
