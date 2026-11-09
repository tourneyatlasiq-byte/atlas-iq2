-- auth_01: what an invited person may see about their own invitations (2026-11).
--
-- Why: the invited person usually has no organization yet, so RLS lets them
-- read the invites row addressed to their email but not the organization or
-- team it names. Without names, /invite and /welcome could not tell them what
-- they were invited to, and /invite fell back to a silent redirect.
--
-- All three functions are read-only, SECURITY DEFINER with a pinned search_path,
-- executable by signed-in users only (not anon, not PUBLIC), and return the
-- minimum needed for those two pages. None writes anything. Acceptance is
-- unchanged and still goes through accept_invite(), which re-checks every rule.
--
-- Disclosure is deliberately narrow:
--   * my_pending_invitations(): only invitations addressed to the caller's own
--     signed-in email, unaccepted and unexpired.
--   * invitation_for_viewer(id): the invitation id is an unguessable random
--     UUID that the invited person received. Someone holding the link learns
--     the organization, team, role and the inviter's first name, and only a
--     masked form of the invited address. An invitation that was already used
--     by someone else reveals nothing beyond that fact.

-- The inviter's first name, or null. Profiles without a real name default to
-- the local part of the email address (accept_invite, create_organization_
-- setup), and showing that would expose part of the inviter's email, so a
-- name equal to the email's local part is treated as no name.
create or replace function public.inviter_display_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when nullif(btrim(p.full_name), '') is null then null
           when lower(btrim(p.full_name)) = lower(split_part(u.email, '@', 1)) then null
           else split_part(btrim(p.full_name), ' ', 1)
         end
    from profiles p
    join auth.users u on u.id = p.id
   where p.id = p_profile_id;
$$;

comment on function public.inviter_display_name(uuid) is
  'auth_01: inviter first name for invitation pages; null when the profile name is just the email local part. Internal helper.';

create or replace function public.invitation_for_viewer(p_invite_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
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
         i.expires_at, o.name as org_name, t.name as team_name,
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

  select pr.organization_id, o2.name
    into v_viewer_org, v_viewer_org_name
    from profiles pr
    left join organizations o2 on o2.id = pr.organization_id
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
$$;

comment on function public.invitation_for_viewer(uuid) is
  'auth_01: state of one invitation for the signed-in viewer (ready, wrong_account, expired, used, already_member, other_org, not_found). Read-only.';

create or replace function public.my_pending_invitations()
returns table (
  invite_id uuid,
  organization_name text,
  team_name text,
  role text,
  expires_at timestamptz,
  inviter_first_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, o.name, t.name, i.role, i.expires_at,
         public.inviter_display_name(i.created_by)
    from invites i
    join organizations o on o.id = i.organization_id
    left join teams t on t.id = i.team_id
   where auth.uid() is not null
     and auth.email() is not null
     and lower(btrim(i.email)) = lower(btrim(auth.email()))
     and i.accepted_at is null
     and (i.expires_at is null or i.expires_at > now())
   order by i.created_at desc;
$$;

comment on function public.my_pending_invitations() is
  'auth_01: unaccepted, unexpired invitations addressed to the signed-in email. Read-only.';

-- Signed-in users only. Supabase grants EXECUTE on new public functions to
-- anon by default, and Postgres grants it to PUBLIC; remove both.
revoke all on function public.inviter_display_name(uuid) from public, anon, authenticated;
revoke all on function public.invitation_for_viewer(uuid) from public, anon;
revoke all on function public.my_pending_invitations() from public, anon;
grant execute on function public.invitation_for_viewer(uuid) to authenticated;
grant execute on function public.my_pending_invitations() to authenticated;
