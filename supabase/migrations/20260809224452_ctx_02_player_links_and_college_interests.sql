-- Recruiting and social links for a player.
--
-- link_type is free text with a suggested list rather than an enum: the
-- platforms coaches use will change faster than migrations.
create table player_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  player_id       uuid not null references players(id) on delete cascade,
  link_type       text not null,
  url             text not null,
  label           text,
  created_at      timestamptz not null default now()
);

create index idx_player_links_player on player_links (player_id);

-- Colleges a player is interested in.
--
-- Deliberately has no status column. The request was "colleges a player is
-- interested in, and the coach's contact details". A six-value recruiting
-- status would be the start of a CRM nobody asked for. If coaches ask for it,
-- one column and one dropdown adds it — and by then we will know which values
-- they actually use.
create table player_college_interests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  player_id       uuid not null references players(id) on delete cascade,
  college_name    text not null,
  notes           text,
  contact_id      uuid references contacts(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_college_interests_player on player_college_interests (player_id);

-- One director per event. Provider-level inheritance was considered and
-- rejected: a provider's events span several states in this data, so the
-- director differs by region — and an override column makes contact_id IS NULL
-- ambiguous between "inherit" and "none".
alter table tournaments
  add column contact_id uuid references contacts(id) on delete set null;

comment on column tournaments.contact_id is
  'Tournament director for this event. Deliberately per-event, not inherited
   from the provider.';

alter table player_links enable row level security;
alter table player_college_interests enable row level security;

create policy "player_links: org read" on player_links
  for select using (organization_id = (select auth_organization_id()));
create policy "player_links: org write" on player_links
  for all
  using (organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (organization_id = (select auth_organization_id()) and (select auth_can_write()));

create policy "college_interests: org read" on player_college_interests
  for select using (organization_id = (select auth_organization_id()));
create policy "college_interests: org write" on player_college_interests
  for all
  using (organization_id = (select auth_organization_id()) and (select auth_can_write()))
  with check (organization_id = (select auth_organization_id()) and (select auth_can_write()));
