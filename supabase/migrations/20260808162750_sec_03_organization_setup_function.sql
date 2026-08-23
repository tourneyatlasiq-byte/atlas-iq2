-- First-run setup for a BRAND NEW organization.
--
-- One transaction: organization, owner profile, team, current season. Either
-- all four exist or none do — a half-created organization would leave the user
-- in the same dead end this function exists to remove.
--
-- Deliberately takes no role argument. The creator of a new organization is
-- its owner by definition; accepting a role from the client is how the
-- previous vulnerability worked.

create or replace function public.create_organization_setup(
  p_organization_name text,
  p_team_name text,
  p_season_name text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_team uuid;
  v_season uuid;
  v_org_name text := nullif(btrim(p_organization_name), '');
  v_team_name text := nullif(btrim(p_team_name), '');
  v_season_name text := nullif(btrim(p_season_name), '');
begin
  if v_user is null then
    raise exception 'You must be signed in to set up an organization.'
      using errcode = 'insufficient_privilege';
  end if;

  -- One setup per account. Without this a user could create organizations
  -- repeatedly, or re-run setup to escape an invited role.
  if exists (select 1 from profiles where id = v_user) then
    raise exception 'This account is already set up.'
      using errcode = 'unique_violation';
  end if;

  if v_org_name is null then raise exception 'Enter an organization name.'; end if;
  if v_team_name is null then raise exception 'Enter a team name.'; end if;
  if v_season_name is null then raise exception 'Enter a season.'; end if;

  insert into organizations (name) values (v_org_name) returning id into v_org;

  -- Role is hardcoded. It is never read from an argument.
  insert into profiles (id, organization_id, full_name, role)
  values (
    v_user,
    v_org,
    coalesce(nullif(btrim((auth.jwt() -> 'user_metadata' ->> 'full_name')), ''),
             split_part(coalesce(auth.email(), 'coach'), '@', 1)),
    'owner'
  );

  insert into teams (organization_id, name, is_placeholder_name)
  values (v_org, v_team_name, false) returning id into v_team;

  insert into seasons (team_id, name, is_current, is_placeholder)
  values (v_team, v_season_name, true, false) returning id into v_season;

  return json_build_object(
    'organization_id', v_org,
    'team_id', v_team,
    'season_id', v_season
  );
end;
$$;

comment on function public.create_organization_setup(text, text, text) is
  'Creates a new organization with the calling user as owner, plus an initial
   team and current season, in one transaction. Refuses if the account already
   has a profile. Takes no role argument by design.';

revoke all on function public.create_organization_setup(text, text, text) from public;
grant execute on function public.create_organization_setup(text, text, text) to authenticated;
