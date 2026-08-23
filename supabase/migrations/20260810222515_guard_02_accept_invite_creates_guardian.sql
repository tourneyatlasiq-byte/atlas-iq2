create or replace function public.accept_invite(p_invite_id uuid)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
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

  select * into v_invite from invites
  where id = p_invite_id
    and lower(btrim(email)) = lower(btrim(v_email));

  if v_invite is null then
    raise exception 'That invitation is not valid for this account.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_invite.accepted_at is not null then
    raise exception 'That invitation has already been used.'
      using errcode = 'unique_violation';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'That invitation has expired. Ask for a new one.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_invite.role not in ('coach','manager','parent') then
    raise exception 'That invitation is not valid.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A parent invitation must name the player it grants access to. Authorization
  -- is never derived from parent_email or any other free-text field.
  if v_invite.role = 'parent' and v_invite.player_id is null then
    raise exception 'That invitation is incomplete. Ask for a new one.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_invite.player_id is not null
     and not exists (select 1 from players p
                     where p.id = v_invite.player_id
                       and p.organization_id = v_invite.organization_id) then
    raise exception 'That invitation is not valid.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into profiles (id, organization_id, full_name, role)
  values (
    v_user,
    v_invite.organization_id,
    coalesce(nullif(btrim((auth.jwt() -> 'user_metadata' ->> 'full_name')), ''),
             split_part(v_email, '@', 1)),
    v_invite.role
  );

  -- team_memberships governs shared team information only.
  if v_invite.team_id is not null then
    insert into team_memberships (profile_id, team_id, role)
    values (v_user, v_invite.team_id, v_invite.role)
    on conflict do nothing;
  end if;

  -- player_guardians governs private and family-financial information only.
  if v_invite.player_id is not null then
    insert into player_guardians (organization_id, profile_id, player_id, created_by)
    values (v_invite.organization_id, v_user, v_invite.player_id, v_invite.created_by)
    on conflict do nothing;
  end if;

  update invites set accepted_at = now(), accepted_by = v_user where id = v_invite.id;

  return json_build_object(
    'organization_id', v_invite.organization_id,
    'role', v_invite.role,
    'team_id', v_invite.team_id,
    'player_id', v_invite.player_id
  );
end;
$function$;
