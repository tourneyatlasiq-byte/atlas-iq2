-- feat_01_organization_features
--
-- Per-organization feature gating. Strictly additive: no existing table,
-- column, policy, function or trigger is altered.
--
-- Default OFF is structural. No row is created for any organization, and
-- auth_org_has_feature() coalesces absence to false. There is no backfill,
-- so no existing organization's behaviour changes.

create table public.organization_features (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key     text not null,
  enabled         boolean not null default false,
  enabled_at      timestamptz,
  enabled_by      uuid references auth.users(id),
  primary key (organization_id, feature_key)
);

comment on table public.organization_features is
  'Per-organization feature flags. Absence of a row means disabled.';

-- Same shape as auth_can_write() / auth_organization_id(): STABLE,
-- SECURITY DEFINER, search_path pinned.
create function public.auth_org_has_feature(p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select f.enabled
      from organization_features f
     where f.organization_id = auth_organization_id()
       and f.feature_key = p_key
  ), false);
$$;

revoke execute on function public.auth_org_has_feature(text) from public;
grant execute on function public.auth_org_has_feature(text) to authenticated;

alter table public.organization_features enable row level security;

-- Read-only to the application. There is deliberately no insert, update or
-- delete policy: enabling a premium feature is an operator action performed
-- in SQL, not something any authenticated user can do. This is what makes
-- "default OFF for every organization" a guarantee rather than a convention.
create policy "organization_features: own org read"
  on public.organization_features
  for select
  using (organization_id = (select public.auth_organization_id()));
