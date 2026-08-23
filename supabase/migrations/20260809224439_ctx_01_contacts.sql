-- People a coach needs to reach: club directors, tournament directors,
-- college coaches.
--
-- Organization-scoped, not shared across Season Tempo. Your contacts are
-- yours — another club dealing with PGF may deal with a different person, and
-- a shared directory would need moderation we deliberately avoided repeating
-- after facilities.
--
-- One record per person. Five providers in this data run 17 of 20 tournaments
-- between them, so a director's phone number must be stored once and linked
-- many times, not copied per event.

create table contacts (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,

  full_name              text not null,

  -- What kind of contact this is. Explicit, because absence of a link does not
  -- mean someone is a club director — a tournament contact may sit in the
  -- directory before any event is linked to it.
  contact_category       text not null default 'Other'
                         check (contact_category in ('Organization','Tournament','College','Other')),

  -- The actual role: Club Director, Tournament Director, Head Coach,
  -- Recruiting Coordinator. Kept separate from category on purpose — category
  -- is for grouping, title is for reading.
  title                  text,

  organization_or_school text,
  email                  text,
  phone                  text,
  notes                  text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index idx_contacts_org on contacts (organization_id);
create index idx_contacts_category on contacts (organization_id, contact_category);

comment on table contacts is
  'People a coach needs to reach. Organization-scoped. contact_category groups
   them; title describes the actual role.';

alter table contacts enable row level security;

create policy "contacts: org read" on contacts
  for select using (organization_id = (select auth_organization_id()));

create policy "contacts: org write" on contacts
  for all
  using (organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (organization_id = (select auth_organization_id()) and (select auth_can_write()));
