-- inv_01: invitation delivery and lifecycle (Phase 2A, 2026-11).
--
-- Additive. Existing invitations keep their rows, links, roles and expiry
-- dates; nothing here sends email. What changes:
--
--   1. invites gains delivery tracking and revoke-as-state columns. Every row
--      that exists when this runs is marked delivery_status = 'manual' (its
--      link was shared by hand), and a 'manual' invitation can NEVER be
--      emailed: invite_send_begin() refuses it. Turning email on later cannot
--      email an existing invitation, and neither can a Resend click.
--   2. One live (unaccepted, unrevoked) invitation per organization + email.
--   3. invite_sends records each send attempt for rate limits and audit. It
--      stores no email address and no message content. Owners/admins of the
--      organization can read their own rows; nobody can write them directly.
--   4. invite_send_begin() / invite_send_finish(): the only way a send is
--      recorded. Begin locks the invitation and enforces the approved limits:
--        - 10 minutes after a successful send before the same invitation again
--        - 5 attempts per invitation per 24 hours
--        - 20 attempts per organization per 24 hours
--        - 40 attempts across the whole service per 24 hours (sign-in emails
--          share the same provider allowance and must never be starved)
--      A failed attempt can be retried at once (still counted in the caps).
--      'sent' means handed to the email provider, not confirmed delivery.
--   5. Revoke is a state: accept_invite() refuses a withdrawn invitation,
--      invitation_for_viewer() reports it, my_pending_invitations() hides it.
--
-- Authorization uses auth_organization_id() / auth_is_org_admin(), so the
-- multi-organization helper migration (Phase 3) applies here unchanged.

-- 1. invites: delivery tracking and revoke-as-state ----------------------------

alter table public.invites
  add column if not exists delivery_status text not null default 'manual',
  add column if not exists last_sent_at timestamptz,
  add column if not exists send_count integer not null default 0,
  add column if not exists last_send_error text,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.profiles(id) on delete set null;

alter table public.invites
  add constraint invites_delivery_status_check
    check (delivery_status in ('manual', 'queued', 'sending', 'sent', 'failed')),
  add constraint invites_send_count_check check (send_count >= 0),
  add constraint invites_last_send_error_check
    check (last_send_error is null or last_send_error in
      ('provider_rejected', 'provider_unavailable', 'timeout', 'not_configured',
       'invalid_recipient', 'stale', 'unknown')),
  add constraint invites_not_both_accepted_and_revoked
    check (accepted_at is null or revoked_at is null);

comment on column public.invites.delivery_status is
  'inv_01: manual = link shared by hand, never emailed (all pre-Phase-2 rows); queued = created to be emailed; sending/sent/failed = last email attempt. sent means handed to the provider, not confirmed delivery.';
comment on column public.invites.revoked_at is
  'inv_01: set when an owner withdraws the invitation. A revoked invitation cannot be accepted.';

-- 2. one live invitation per organization + email ------------------------------

create unique index if not exists invites_one_live_per_email
  on public.invites (organization_id, lower(btrim(email)))
  where accepted_at is null and revoked_at is null;

-- 3. send attempts --------------------------------------------------------------

create table if not exists public.invite_sends (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.invites(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sent_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  error_code text check (error_code is null or error_code in
    ('provider_rejected', 'provider_unavailable', 'timeout', 'not_configured',
     'invalid_recipient', 'stale', 'unknown'))
);

comment on table public.invite_sends is
  'inv_01: one row per invitation email attempt, for rate limits and audit. No email address or message content is stored. Written only by invite_send_begin/finish.';

create index if not exists idx_invite_sends_invite on public.invite_sends (invite_id, created_at desc);
create index if not exists idx_invite_sends_org on public.invite_sends (organization_id, created_at desc);
create index if not exists idx_invite_sends_created on public.invite_sends (created_at desc);

alter table public.invite_sends enable row level security;

create policy "invite_sends: admins read own org"
  on public.invite_sends for select
  using (organization_id = (select auth_organization_id()) and (select auth_is_org_admin()));
-- No insert, update or delete policies: rows are written only by the
-- SECURITY DEFINER functions below, so the rate limits cannot be reset.

-- 4. begin / finish a send ------------------------------------------------------

create or replace function public.invite_send_begin(p_invite_id uuid)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_inv record;
  v_attempt uuid;
  v_count int;
  v_last_sent timestamptz;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv from invites where id = p_invite_id for update;

  -- Same message for "no such invitation" and "not yours", so an id outside
  -- the caller's organization reveals nothing.
  if not found
     or v_inv.organization_id is distinct from auth_organization_id()
     or not auth_is_org_admin() then
    raise exception 'That invitation could not be found.' using errcode = 'insufficient_privilege';
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'That invitation has already been accepted.' using errcode = 'check_violation';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'That invitation was withdrawn.' using errcode = 'check_violation';
  end if;
  if v_inv.delivery_status = 'manual' then
    raise exception 'This invitation was shared by link, so it can''t be emailed. To email it, revoke it and send a new invitation.'
      using errcode = 'check_violation';
  end if;

  -- An attempt that never finished (server stopped mid-send) stops blocking
  -- after two minutes. It still counts towards the daily caps.
  update invite_sends
     set status = 'failed', error_code = 'stale', finished_at = now()
   where invite_id = v_inv.id and status = 'sending'
     and created_at < now() - interval '2 minutes';

  if exists (select 1 from invite_sends where invite_id = v_inv.id and status = 'sending') then
    raise exception 'That invitation is already being sent.' using errcode = 'check_violation';
  end if;

  select max(created_at) into v_last_sent
    from invite_sends where invite_id = v_inv.id and status = 'sent';
  if v_last_sent is not null and v_last_sent > now() - interval '10 minutes' then
    raise exception 'That invitation was emailed a few minutes ago. You can send it again 10 minutes after the last email.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_count from invite_sends
   where invite_id = v_inv.id and created_at > now() - interval '24 hours';
  if v_count >= 5 then
    raise exception 'That invitation has been emailed 5 times today. Copy the link instead, or try again tomorrow.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_count from invite_sends
   where organization_id = v_inv.organization_id and created_at > now() - interval '24 hours';
  if v_count >= 20 then
    raise exception 'Your organization has reached today''s limit for invitation emails. Copy the link instead, or try again tomorrow.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_count from invite_sends
   where created_at > now() - interval '24 hours';
  if v_count >= 40 then
    raise exception 'Invitation emails are paused for today. Copy the link instead, or try again tomorrow.'
      using errcode = 'check_violation';
  end if;

  -- Each email gives the invitation 14 days from the moment it is sent, so
  -- the expiry date in the email is always the real one.
  v_expires := now() + interval '14 days';

  insert into invite_sends (invite_id, organization_id, sent_by, status)
  values (v_inv.id, v_inv.organization_id, v_user, 'sending')
  returning id into v_attempt;

  update invites
     set delivery_status = 'sending', expires_at = v_expires
   where id = v_inv.id;

  return json_build_object(
    'attempt_id', v_attempt,
    'invite_id', v_inv.id,
    'email', lower(btrim(v_inv.email)),
    'role', v_inv.role,
    'organization_name', (select name from organizations where id = v_inv.organization_id),
    'team_name', (select name from teams where id = v_inv.team_id),
    'inviter_first_name', public.inviter_display_name(v_user),
    'expires_at', v_expires
  );
end;
$$;

comment on function public.invite_send_begin(uuid) is
  'inv_01: claims one email attempt for an invitation (owner/admin of its organization only), enforcing the Phase 2 rate limits. Refuses manual (link-shared) invitations.';

create or replace function public.invite_send_finish(
  p_attempt_id uuid,
  p_ok boolean,
  p_message_id text default null,
  p_error_code text default null
)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_att record;
  v_error text;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_att from invite_sends where id = p_attempt_id for update;

  if not found
     or v_att.organization_id is distinct from auth_organization_id()
     or not auth_is_org_admin() then
    raise exception 'That send attempt could not be found.' using errcode = 'insufficient_privilege';
  end if;

  if v_att.status <> 'sending' then
    -- Already finished (or timed out as stale). Nothing to change.
    return json_build_object('status', v_att.status);
  end if;

  if p_ok then
    update invite_sends
       set status = 'sent', finished_at = now(),
           provider_message_id = left(p_message_id, 200)
     where id = v_att.id;
    update invites
       set delivery_status = 'sent', last_sent_at = now(),
           send_count = send_count + 1, last_send_error = null
     where id = v_att.invite_id;
    return json_build_object('status', 'sent');
  end if;

  v_error := case when p_error_code in
    ('provider_rejected', 'provider_unavailable', 'timeout', 'not_configured', 'invalid_recipient')
    then p_error_code else 'unknown' end;

  update invite_sends
     set status = 'failed', finished_at = now(), error_code = v_error
   where id = v_att.id;
  update invites
     set delivery_status = 'failed', last_send_error = v_error
   where id = v_att.invite_id;
  return json_build_object('status', 'failed', 'error_code', v_error);
end;
$$;

comment on function public.invite_send_finish(uuid, boolean, text, text) is
  'inv_01: records the outcome of one email attempt. sent = handed to the provider.';

-- 5. revoke-as-state in the existing functions ---------------------------------

-- accept_invite: unchanged except the withdrawn check after the used check.
create or replace function public.accept_invite(p_invite_id uuid)
returns json
language plpgsql
security definer
set search_path = public
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

  if v_invite.revoked_at is not null then
    raise exception 'That invitation was withdrawn. Ask for a new one.'
      using errcode = 'insufficient_privilege';
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

-- invitation_for_viewer (auth_01): adds the 'revoked' state after 'used'.
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

-- my_pending_invitations (auth_01): withdrawn invitations are not pending.
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
     and i.revoked_at is null
     and (i.expires_at is null or i.expires_at > now())
   order by i.created_at desc;
$$;

-- 6. grants ---------------------------------------------------------------------

revoke all on function public.invite_send_begin(uuid) from public, anon;
revoke all on function public.invite_send_finish(uuid, boolean, text, text) from public, anon;
grant execute on function public.invite_send_begin(uuid) to authenticated;
grant execute on function public.invite_send_finish(uuid, boolean, text, text) to authenticated;

-- CREATE OR REPLACE keeps existing privileges; restated so this file alone
-- describes the intended access.
revoke all on function public.invitation_for_viewer(uuid) from public, anon;
revoke all on function public.my_pending_invitations() from public, anon;
grant execute on function public.invitation_for_viewer(uuid) to authenticated;
grant execute on function public.my_pending_invitations() to authenticated;
