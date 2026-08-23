-- An organization's private operational knowledge about a shared facility.
-- Never visible to other organizations. Rating and would_return are deliberately
-- deferred until real usage shows how facility evaluation should work.
create table if not exists organization_facilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  facility_id uuid not null references facilities(id) on delete cascade,
  parking_notes text,
  entry_notes text,
  concessions_notes text,
  restroom_notes text,
  seating_notes text,
  internal_notes text,
  created_at timestamptz not null default now(),
  constraint organization_facilities_unique unique (organization_id, facility_id)
);

create index if not exists idx_org_facilities_org on organization_facilities (organization_id);
create index if not exists idx_org_facilities_facility on organization_facilities (facility_id);

alter table organization_facilities enable row level security;

-- Strictly private to the owning organization. No cross-org visibility.
drop policy if exists "organization_facilities: org read" on organization_facilities;
create policy "organization_facilities: org read" on organization_facilities for select
  using (organization_id = (select auth_organization_id()));

drop policy if exists "organization_facilities: org write" on organization_facilities;
create policy "organization_facilities: org write" on organization_facilities for all
  using (organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (organization_id = (select auth_organization_id()) and (select auth_can_write()));

comment on table organization_facilities is
  'Organization-specific operational knowledge about a shared facility: parking, entry,
   concessions, restrooms, seating, internal notes. Private to the organization.
   Presence of a row means "we have written something down", not "we use this venue" —
   relevance is already answered by tournaments referencing the facility.';
