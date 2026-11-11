-- org_02: permission helpers read organization memberships + per-request pin — Phase 3B.
--
-- Changes WHERE authority is read, not WHAT anyone can do: in Phase 3 every person has
-- exactly one membership, kept in step with their profile by org_01, so effective access
-- is identical for every account.
--
-- Pin: request header x-season-tempo-org (PostgREST request.headers).
--   absent                                   -> TEMPORARY compatibility fallback (the app
--                                               sends no pin before 3C)
--   one valid uuid = active organization     -> normal access
--   another / nonexistent organization       -> no organization (no access)
--   malformed, empty, non-string, duplicated
--   (any case), comma-joined, bad JSON       -> no organization (no access), never an error
--
-- Helpers keep their names, signatures, grants and volatility. auth_org_role() returns the
-- membership's legacy_role; auth_can_write() keeps owner/admin/coach/manager;
-- auth_is_org_admin() uses membership authority; auth_team_ids() bounds teams by the
-- resolved organization before team assignments are considered.
-- Converted direct profile readers: enforce_guardian_org, invitation_for_viewer, the
-- team-logo storage rule and the legacy roster rule. The invitee self-delete rule on
-- invites is intentionally NOT changed in 3B.

-- auth_request_org_pin
CREATE OR REPLACE FUNCTION public.auth_request_org_pin()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Phase 3B pin: request header x-season-tempo-org, as delivered by PostgREST in
  -- request.headers. Returns 'absent', 'invalid' or the canonical uuid. Never raises:
  -- every value is validated with pg_input_is_valid before any cast.
  with raw as (
    select nullif(current_setting('request.headers', true), '') as h
  ), doc as (
    select h,
           case when h is not null and pg_input_is_valid(h, 'json') then h::json end as j
      from raw
  ), hits as (
    select h, j,
           case when json_typeof(j) = 'object' then
             (select count(*) from json_each(j) e where lower(e.key) = 'x-season-tempo-org') end as n,
           case when json_typeof(j) = 'object' then
             (select e.value from json_each(j) e where lower(e.key) = 'x-season-tempo-org' limit 1) end as v
      from doc
  )
  select case
           when h is null                                   then 'absent'
           when j is null or json_typeof(j) <> 'object'     then 'invalid'
           when n = 0                                       then 'absent'
           when n > 1                                       then 'invalid'
           when json_typeof(v) <> 'string'                  then 'invalid'
           when btrim(v #>> '{}') = ''                      then 'invalid'
           when not pg_input_is_valid(v #>> '{}', 'uuid')   then 'invalid'
           else (v #>> '{}')::uuid::text
         end
    from hits
$function$;

-- auth_active_membership
CREATE OR REPLACE FUNCTION public.auth_active_membership()
 RETURNS TABLE(organization_id uuid, authority text, legacy_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Phase 3B: the caller's active membership, only when the request pin is absent
  -- (transitional fallback) or names that same organization. Internal.
  select m.organization_id, m.authority, m.legacy_role
    from profiles p
    join organization_memberships m
      on m.user_id = p.id
     and m.organization_id = p.active_organization_id
   where p.id = auth.uid()
     and public.auth_request_org_pin() in ('absent', m.organization_id::text)
$function$;

revoke all on function public.auth_request_org_pin() from public, anon, authenticated;
revoke all on function public.auth_active_membership() from public, anon, authenticated;

-- auth_organization_id
CREATE OR REPLACE FUNCTION public.auth_organization_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select organization_id from public.auth_active_membership();
$function$;

-- auth_org_role
CREATE OR REPLACE FUNCTION public.auth_org_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Transitional: the membership's legacy_role (exact copy of today's role).
  select legacy_role from public.auth_active_membership();
$function$;

-- auth_can_write
CREATE OR REPLACE FUNCTION public.auth_can_write()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select legacy_role from public.auth_active_membership())
                  in ('owner','admin','coach','manager'), false);
$function$;

-- auth_is_org_admin
CREATE OR REPLACE FUNCTION public.auth_is_org_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select authority from public.auth_active_membership()) in ('owner','admin'), false);
$function$;

-- auth_team_ids
CREATE OR REPLACE FUNCTION public.auth_team_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Teams are bounded by the resolved (active, pinned) organization FIRST; a team
  -- assignment only selects among those teams and can never add another
  -- organization's team.
  select t.id
    from teams t
    join public.auth_active_membership() am on am.organization_id = t.organization_id
   where am.authority in ('owner','admin')
      or exists (select 1 from team_memberships tm
                  where tm.team_id = t.id and tm.profile_id = auth.uid());
$function$;

-- enforce_guardian_org
CREATE OR REPLACE FUNCTION public.enforce_guardian_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Phase 3B: the guardian must hold a membership in the player's organization,
  -- and the row's organization must be that organization.
  if not exists (
    select 1
      from players pl
      join organization_memberships m
        on m.user_id = new.profile_id and m.organization_id = pl.organization_id
     where pl.id = new.player_id
       and new.organization_id = pl.organization_id
  ) then
    raise exception 'Guardian, player and organization must all match.'
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

-- invitation_for_viewer
CREATE OR REPLACE FUNCTION public.invitation_for_viewer(p_invite_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(auth.email()));
  v_inv record;
  v_viewer_org uuid;
  v_viewer_org_name text;
  v_local text;
  v_masked text;
begin
  if v_user is null or v_email is null then
    raise exception 'You must be signed in to view an invitation.'
      using errcode = 'insufficient_privilege';
  end if;

  select i.id, i.email, i.role, i.organization_id, i.accepted_at, i.accepted_by,
         i.expires_at, i.revoked_at, o.name as org_name, t.name as team_name,
         public.inviter_display_name(i.created_by) as inviter_first
    into v_inv
    from invites i
    join organizations o on o.id = i.organization_id
    left join teams t on t.id = i.team_id
   where i.id = p_invite_id;

  if not found then
    return json_build_object('status', 'not_found');
  end if;

  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = v_user then
      return json_build_object('status', 'accepted_by_you', 'organization_name', v_inv.org_name);
    end if;
    return json_build_object('status', 'used');
  end if;

  if v_inv.revoked_at is not null then
    return json_build_object('status', 'revoked', 'organization_name', v_inv.org_name);
  end if;

  v_local := split_part(lower(btrim(v_inv.email)), '@', 1);
  v_masked := left(v_local, 1) || '•••@' || split_part(lower(btrim(v_inv.email)), '@', 2);

  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    return json_build_object(
      'status', 'expired',
      'organization_name', v_inv.org_name,
      'team_name', v_inv.team_name,
      'role', v_inv.role,
      'inviter_first_name', v_inv.inviter_first,
      'invited_email_masked', v_masked
    );
  end if;

  if lower(btrim(v_inv.email)) <> v_email then
    return json_build_object(
      'status', 'wrong_account',
      'organization_name', v_inv.org_name,
      'team_name', v_inv.team_name,
      'role', v_inv.role,
      'inviter_first_name', v_inv.inviter_first,
      'invited_email_masked', v_masked
    );
  end if;

  -- Phase 3B: the viewer's organization comes from their active membership
  -- (not pin-gated: this page is outside any organization).
  select m.organization_id, o2.name
    into v_viewer_org, v_viewer_org_name
    from profiles pr
    join organization_memberships m
      on m.user_id = pr.id and m.organization_id = pr.active_organization_id
    left join organizations o2 on o2.id = m.organization_id
   where pr.id = v_user;

  if v_viewer_org is not null and v_viewer_org = v_inv.organization_id then
    return json_build_object('status', 'already_member', 'organization_name', v_inv.org_name);
  end if;

  return json_build_object(
    -- 'other_org' until multi-organization membership exists: accept_invite()
    -- still refuses an account that already belongs to an organization.
    'status', case when v_viewer_org is not null then 'other_org' else 'ready' end,
    'organization_name', v_inv.org_name,
    'team_name', v_inv.team_name,
    'role', v_inv.role,
    'inviter_first_name', v_inv.inviter_first,
    'expires_at', v_inv.expires_at,
    'viewer_organization_name', v_viewer_org_name
  );
end;
$function$;

-- Direct profile readers in rules: same names, same roles, same effect.
drop policy "team-logos: owners manage" on storage.objects;
create policy "team-logos: owners manage" on storage.objects as PERMISSIVE for ALL to public
  using      ((bucket_id = 'team-logos') and ((storage.foldername(name))[1] = (select auth_organization_id())::text) and ((select auth_org_role()) = 'owner'))
  with check ((bucket_id = 'team-logos') and ((storage.foldername(name))[1] = (select auth_organization_id())::text) and ((select auth_org_role()) = 'owner'));

drop policy "roster: coach/manager write" on public.roster;
create policy "roster: coach/manager write" on public.roster as PERMISSIVE for ALL to public
  using ((organization_id = auth_organization_id()) and ((select auth_org_role()) = any (array['coach', 'manager'])));
