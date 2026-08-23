-- #176 durable guardian relationship, #177 archive lifecycle. Additive only.

create table if not exists public.player_guardians (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique (profile_id, player_id)
);
create index if not exists player_guardians_profile_idx on public.player_guardians(profile_id);
create index if not exists player_guardians_player_idx on public.player_guardians(player_id);
alter table public.player_guardians enable row level security;

-- SECURITY DEFINER writes bypass RLS, so assert org agreement at the row level.
create or replace function public.enforce_guardian_org() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_p uuid; v_pl uuid;
begin
  select organization_id into v_p from profiles where id = new.profile_id;
  select organization_id into v_pl from players where id = new.player_id;
  if v_p is null or v_pl is null or v_p <> v_pl or new.organization_id <> v_p then
    raise exception 'Guardian, player and organization must all match.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists guardian_org_integrity on public.player_guardians;
create trigger guardian_org_integrity before insert or update on public.player_guardians
  for each row execute function public.enforce_guardian_org();

create policy "guardians: admin manage" on public.player_guardians for all
  using (organization_id = (select auth_organization_id()) and (select auth_is_org_admin()))
  with check (organization_id = (select auth_organization_id()) and (select auth_is_org_admin()));
create policy "guardians: read own" on public.player_guardians for select
  using (profile_id = auth.uid());

create or replace function public.auth_linked_player_ids() returns setof uuid
language sql stable security definer set search_path to 'public' as $$
  select player_id from player_guardians where profile_id = auth.uid();
$$;
revoke execute on function public.auth_linked_player_ids() from anon, public;
grant execute on function public.auth_linked_player_ids() to authenticated;

-- Parent invitations carry the explicit player link.
alter table public.invites add column if not exists player_id uuid references public.players(id) on delete cascade;
alter table public.invites drop constraint if exists invites_player_only_for_parent;
alter table public.invites add constraint invites_player_only_for_parent
  check (player_id is null or role = 'parent');

-- Document visibility. Every existing row defaults to staff-only.
alter table public.documents add column if not exists visibility text not null default 'staff';
alter table public.documents drop constraint if exists documents_visibility_check;
alter table public.documents add constraint documents_visibility_check
  check (visibility in ('staff','team'));

-- #177 archive state. All existing players remain active (archived_at is null).
alter table public.players add column if not exists archived_at timestamptz;
alter table public.players add column if not exists archived_by uuid references public.profiles(id);
create index if not exists players_active_idx on public.players(organization_id) where archived_at is null;
