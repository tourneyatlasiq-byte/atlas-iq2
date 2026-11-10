-- org_01: organization memberships — Phase 3A, structure only (2026-11).
--
-- Adds the multi-organization structure IN PARALLEL with today's model.
-- Nothing in the application, the existing permission helpers, storage rules or
-- server actions reads organization_memberships or active_organization_id yet.
-- profiles.organization_id / profiles.role remain the only source of truth.
--
--   * organization_memberships: one row per person per organization, carrying
--     organization authority (owner | admin | member) and legacy_role, an exact
--     copy of today's profiles.role. No team titles are inferred.
--   * Phase 3 guard: at most ONE membership per person. Nobody can hold a second
--     organization membership until Phase 4 deliberately lifts this index.
--   * profiles.active_organization_id: always equal to profiles.organization_id
--     during Phase 3; cannot be set directly.
--   * Temporary compatibility sync (deliberate, removed only by a separate,
--     proven migration — not automatically by 3B): every profile insert or
--     change of organization/role is mirrored into the membership in the SAME
--     statement. Any sync failure aborts the profile change (fail closed).
--   * Deferred consistency check: at commit, every affected person's profile and
--     membership must agree, so a direct write to either cannot leave them out
--     of step.
--   * team_memberships: unique (profile, team).
--
-- Backfill: one membership per existing profile, same organization and role.

-- 1. Table -------------------------------------------------------------------
create table public.organization_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  authority       text not null check (authority in ('owner', 'admin', 'member')),
  legacy_role     text not null check (legacy_role in ('owner', 'admin', 'coach', 'manager', 'parent')),
  created_at      timestamptz not null default now(),
  constraint organization_memberships_org_user_unique unique (organization_id, user_id),
  constraint organization_memberships_authority_matches_legacy check (
       (legacy_role = 'owner' and authority = 'owner')
    or (legacy_role = 'admin' and authority = 'admin')
    or (legacy_role in ('coach', 'manager', 'parent') and authority = 'member')
  )
);

comment on table public.organization_memberships is
  'org_01 (Phase 3A): person ↔ organization with organization authority. Structure only — not read by any rule, helper or app code until Phase 3B/3C.';

-- Phase 3 guard: one membership per person. Lifted only by a Phase 4 migration.
create unique index organization_memberships_one_per_user_phase3
  on public.organization_memberships (user_id);
create index organization_memberships_organization_idx
  on public.organization_memberships (organization_id);

alter table public.organization_memberships enable row level security;
revoke all on public.organization_memberships from public, anon, authenticated;
grant select on public.organization_memberships to authenticated;

create policy "organization_memberships: see your own"
  on public.organization_memberships for select to authenticated
  using (user_id = auth.uid());

create policy "organization_memberships: owners and admins see their organization"
  on public.organization_memberships for select to authenticated
  using (
    organization_id = (select auth_organization_id())
    and (select auth_is_org_admin())
  );

-- 2. Active organization ------------------------------------------------------
alter table public.profiles
  add column active_organization_id uuid references public.organizations(id) on delete set null;

comment on column public.profiles.active_organization_id is
  'org_01 (Phase 3A): the organization the person is operating in. Always equals organization_id during Phase 3; not read by any rule yet.';

-- 3. Backfill (before the triggers exist) -------------------------------------
insert into public.organization_memberships (organization_id, user_id, authority, legacy_role, created_at)
select p.organization_id,
       p.id,
       case p.role when 'owner' then 'owner' when 'admin' then 'admin' else 'member' end,
       p.role,
       p.created_at
  from public.profiles p
 where p.organization_id is not null;

update public.profiles set active_organization_id = organization_id;

-- 4. Team memberships: one row per person per team ----------------------------
alter table public.team_memberships
  add constraint team_memberships_profile_team_unique unique (profile_id, team_id);

-- 5. Temporary compatibility sync (Phase 3 only) ------------------------------
-- 5a. Active organization follows the profile's organization and cannot be set directly.
create function public.org_01_sync_active_organization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.active_organization_id is distinct from old.active_organization_id
     and new.organization_id is not distinct from old.organization_id then
    raise exception 'The active organization can''t be changed directly.'
      using errcode = 'insufficient_privilege';
  end if;
  new.active_organization_id := new.organization_id;
  return new;
end;
$$;

create trigger profiles_org_01_active_organization
  before insert or update on public.profiles
  for each row execute function public.org_01_sync_active_organization();

-- 5b. Membership mirrors the profile, in the same statement. Fails closed.
create function public.org_01_sync_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authority text := case new.role when 'owner' then 'owner' when 'admin' then 'admin' else 'member' end;
  v_rows int;
begin
  if tg_op = 'INSERT' then
    if new.organization_id is not null then
      insert into organization_memberships (organization_id, user_id, authority, legacy_role)
      values (new.organization_id, new.id, v_authority, new.role);
    end if;
  elsif new.organization_id is distinct from old.organization_id then
    -- Each path is ONE statement, so no consistency check (deferred or
    -- immediate) can ever observe the person between organizations.
    if old.organization_id is null then
      insert into organization_memberships (organization_id, user_id, authority, legacy_role)
      values (new.organization_id, new.id, v_authority, new.role);
    elsif new.organization_id is null then
      delete from organization_memberships where user_id = new.id;
    else
      update organization_memberships
         set organization_id = new.organization_id, authority = v_authority, legacy_role = new.role
       where user_id = new.id and organization_id = old.organization_id;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'Organization membership sync failed for profile % (expected 1 membership to move, found %).', new.id, v_rows
          using errcode = 'check_violation';
      end if;
    end if;
  elsif new.role is distinct from old.role then
    update organization_memberships
       set authority = v_authority, legacy_role = new.role
     where user_id = new.id and organization_id = new.organization_id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'Organization membership sync failed for profile % (expected 1 membership, found %).', new.id, v_rows
        using errcode = 'check_violation';
    end if;
  end if;
  return null;
end;
$$;

-- Trigger ORDER matters: Postgres fires same-event triggers in name order. The
-- sync ("…_a_sync_membership") must run before the consistency check
-- ("…_z_consistency") so the check never sees a half-applied change — in the
-- default deferred mode AND when constraints are set IMMEDIATE.
create trigger profiles_org_01_a_sync_membership
  after insert or update of organization_id, role on public.profiles
  for each row execute function public.org_01_sync_membership();

-- 5c. Deferred consistency check: profile and membership must agree at commit.
create function public.org_01_assert_consistent(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_org uuid;
  v_role text;
  v_active uuid;
  v_count int;
  v_match int;
begin
  select count(*) into v_count from organization_memberships where user_id = p_user;
  select exists (select 1 from profiles where id = p_user) into v_exists;

  if not v_exists then
    if v_count <> 0 then
      raise exception 'Profile and organization membership are out of step for % (membership without a profile).', p_user
        using errcode = 'check_violation';
    end if;
    return;
  end if;

  select organization_id, role, active_organization_id into v_org, v_role, v_active from profiles where id = p_user;

  if v_active is distinct from v_org then
    raise exception 'Profile and organization membership are out of step for % (active organization differs).', p_user
      using errcode = 'check_violation';
  end if;

  if v_org is null then
    if v_count <> 0 then
      raise exception 'Profile and organization membership are out of step for % (membership without an organization).', p_user
        using errcode = 'check_violation';
    end if;
    return;
  end if;

  select count(*) into v_match
    from organization_memberships m
   where m.user_id = p_user
     and m.organization_id = v_org
     and m.legacy_role = v_role
     and m.authority = case v_role when 'owner' then 'owner' when 'admin' then 'admin' else 'member' end;

  if v_count <> 1 or v_match <> 1 then
    raise exception 'Profile and organization membership are out of step for % (% membership rows, % matching).', p_user, v_count, v_match
      using errcode = 'check_violation';
  end if;
end;
$$;

create function public.org_01_check_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform org_01_assert_consistent(coalesce(new.id, old.id));
  return null;
end;
$$;

create function public.org_01_check_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform org_01_assert_consistent(old.user_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform org_01_assert_consistent(new.user_id);
  end if;
  return null;
end;
$$;

create constraint trigger profiles_org_01_z_consistency
  after insert or update on public.profiles
  deferrable initially deferred
  for each row execute function public.org_01_check_profile();

create constraint trigger organization_memberships_org_01_z_consistency
  after insert or update or delete on public.organization_memberships
  deferrable initially deferred
  for each row execute function public.org_01_check_membership();

-- Trigger and check functions are never callable through the API.
revoke all on function public.org_01_sync_active_organization() from public, anon, authenticated;
revoke all on function public.org_01_sync_membership() from public, anon, authenticated;
revoke all on function public.org_01_assert_consistent(uuid) from public, anon, authenticated;
revoke all on function public.org_01_check_profile() from public, anon, authenticated;
revoke all on function public.org_01_check_membership() from public, anon, authenticated;
