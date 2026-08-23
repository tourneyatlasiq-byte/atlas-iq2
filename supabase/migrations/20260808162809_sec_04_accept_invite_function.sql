-- Joining an EXISTING organization. The only path in.
--
-- The organization and the role both come from the invite, never from the
-- caller. Knowing an organization UUID grants nothing.
--
-- invites.role is CHECK-constrained to coach/manager/parent, so an invite can
-- never confer owner or admin. That constraint is now load-bearing security,
-- not just tidiness.
--
-- Single use is enforced by consuming the invite inside this transaction. The
-- invites table has no accepted_at column, so consumption means deletion —
-- see the note in the migration report about the audit trail this loses.

create or replace function public.accept_invite(p_invite_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_email text := auth.email();
  v_invite record;
begin
  if v_user is null or v_email is null then
    raise exception 'You must be signed in to accept an invitation.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from profiles where id = v_user) then
    raise exception 'This account already belongs to an organization.'
      using errcode = 'unique_violation';
  end if;

  -- Matched on the invite id AND the signed-in email. The id alone is not
  -- enough: an invite is addressed to a person, not merely possessed.
  select * into v_invite
  from invites
  where id = p_invite_id
    and lower(btrim(email)) = lower(btrim(v_email));

  if v_invite is null then
    raise exception 'That invitation is not valid for this account.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_invite.organization_id is null then
    raise exception 'That invitation is not linked to an organization.';
  end if;

  insert into profiles (id, organization_id, full_name, role)
  values (
    v_user,
    v_invite.organization_id,
    coalesce(nullif(btrim((auth.jwt() -> 'user_metadata' ->> 'full_name')), ''),
             split_part(v_email, '@', 1)),
    v_invite.role
  );

  -- An invite may name a team. Without one the user has no team access at all,
  -- which is the correct deny-by-default outcome rather than a silent grant.
  if v_invite.team_id is not null then
    insert into team_memberships (profile_id, team_id, role)
    values (v_user, v_invite.team_id, v_invite.role)
    on conflict do nothing;
  end if;

  delete from invites where id = v_invite.id;

  return json_build_object(
    'organization_id', v_invite.organization_id,
    'role', v_invite.role,
    'team_id', v_invite.team_id
  );
end;
$$;

comment on function public.accept_invite(uuid) is
  'Joins the calling user to the organization named on their invitation, with
   the role the invitation specifies. Matched on invite id AND signed-in email.
   Consumes the invite, so it cannot be reused.';

revoke all on function public.accept_invite(uuid) from public;
grant execute on function public.accept_invite(uuid) to authenticated;
