-- Onboarding must produce the same season record as start_next_season().
--
-- start_next_season() parses the leading year from names like "2026-27" and
-- sets start_date to August 1. create_organization_setup() left it null, so a
-- season created at onboarding and one created a year later differed in a
-- field that atlas_season_phase() reads.
--
-- Phase resolution falls back to created_at when start_date is null, so this
-- was not wrong — but two paths producing different records for the same
-- concept is exactly the drift the audit was looking for.

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
  v_start date;
  v_year int;
  v_org_name text := nullif(btrim(p_organization_name), '');
  v_team_name text := nullif(btrim(p_team_name), '');
  v_season_name text := nullif(btrim(p_season_name), '');
begin
  if v_user is null then
    raise exception 'You must be signed in to set up an organization.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from profiles where id = v_user) then
    raise exception 'This account is already set up.'
      using errcode = 'unique_violation';
  end if;

  if v_org_name is null then raise exception 'Enter an organization name.'; end if;
  if v_team_name is null then raise exception 'Enter a team name.'; end if;
  if v_season_name is null then raise exception 'Enter a season.'; end if;

  insert into organizations (name) values (v_org_name) returning id into v_org;

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

  -- Same derivation as start_next_season(): the travel softball year turns
  -- over in August, so "2026-27" starts 2026-08-01.
  v_year := substring(v_season_name from '^(\d{4})')::int;
  if v_year is not null then
    v_start := make_date(v_year, 8, 1);
  end if;

  insert into seasons (team_id, name, start_date, is_current, is_placeholder)
  values (v_team, v_season_name, v_start, true, false) returning id into v_season;

  return json_build_object(
    'organization_id', v_org,
    'team_id', v_team,
    'season_id', v_season
  );
end;
$$;
