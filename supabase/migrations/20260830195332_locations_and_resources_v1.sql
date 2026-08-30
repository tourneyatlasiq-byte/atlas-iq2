-- Locations & Resources: Facilities grows to hold lodging and dining.
--
-- The table keeps its name. Fifty-three files, eight indexes, five foreign
-- keys and two triggers reference `facilities`; renaming it to match a
-- user-facing label would be a large, risky change that buys nothing. The
-- navigation says Locations & Resources, the schema says facilities, and that
-- is fine.
--
-- WHAT SEPARATES A PLACE FROM AN OPINION.
--
-- facilities is globally readable: any authenticated user in any organization
-- can see every row. That is right for a softball complex -- a shared
-- directory is the point -- and it is exactly wrong for "good breakfast, would
-- use again". A team's judgement is that team's, and putting it on this table
-- would publish it to every other organization in Season Tempo.
--
-- So place FACTS go here, and organization KNOWLEDGE goes on
-- organization_facilities, which is already org-scoped by RLS and already
-- holds precisely this kind of private note.

------------------------------------------------------------------ 1. type
-- Every existing row becomes a facility, which is what all 180 of them are.
-- NOT NULL with a default means no backfill statement and no window where a
-- row has no type.
alter table facilities
  add column if not exists type text not null default 'facility';

alter table facilities drop constraint if exists facilities_type_check;
alter table facilities add constraint facilities_type_check
  check (type in ('facility', 'lodging', 'dining'));

comment on column facilities.type is
  'facility | lodging | dining. Services is deliberately absent: a photographer or a bus company is a business rather than a place, and forcing one into a geographic model gives it an address it does not need and an atlas_id from a geographic sequence.';

------------------------------------------------------------------ 2. phone
-- Shared fact, not organization knowledge. A hotel or restaurant is reached by
-- phone far more often than a ballpark, but the column suits all three types.
alter table facilities add column if not exists phone text;

------------------------------------------------------- 3. honest timestamps
-- created_at defaults to now() for rows created from here on.
--
-- FOR THE 180 EXISTING ROWS THIS IS THE MIGRATION TIME, NOT THEIR CREATION
-- TIME. facilities has never carried timestamps, so when each of those records
-- was actually created cannot be established from anything in the database.
-- Backdating them to an invented date would look like evidence and be
-- fiction. They all carry this migration's timestamp, and this comment is the
-- record of why they are identical.
alter table facilities add column if not exists created_at timestamptz not null default now();
alter table facilities add column if not exists updated_at timestamptz not null default now();

comment on column facilities.created_at is
  'Row creation. For records existing before 2026-08-30 this is the backfill time, not the original creation time -- the table carried no timestamps before then and the true dates are not recoverable.';

-- updated_at is maintained, not merely defaulted: a column that only ever
-- holds its default is worse than no column, because it looks maintained.
create or replace function public.touch_facility_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_facility_updated_at on facilities;
create trigger trg_touch_facility_updated_at
  before update on facilities
  for each row execute function public.touch_facility_updated_at();

--------------------------------------------- 4. organization knowledge
-- EXTENDED, NOT REPLACED. organization_facilities already is the
-- organization-and-place relationship: same grain, same RLS, and its three
-- existing rows already hold private notes about parking, entry, concessions,
-- restrooms and seating. A second table would have meant two rows describing
-- one relationship, and eventually two answers to the same question.
--
-- internal_notes is the notes field for every type. The facility-specific note
-- columns stay for facilities and are simply not shown for lodging or dining.
alter table organization_facilities
  add column if not exists would_use_again text;

alter table organization_facilities drop constraint if exists org_facilities_would_use_again_check;
alter table organization_facilities add constraint org_facilities_would_use_again_check
  check (would_use_again is null or would_use_again in ('yes', 'no'));

comment on column organization_facilities.would_use_again is
  'yes | no | NULL meaning not rated. Organization-private, like every column on this table: RLS restricts it to the owning organization, so one team''s judgement is never visible to another.';

-- One private record per organization per place.
create unique index if not exists organization_facilities_org_facility_unique
  on organization_facilities (organization_id, facility_id);

---------------------------------------------- 5. tournament relationships
-- SEPARATE FROM tournaments.facility_id, WHICH IS UNTOUCHED. That column is
-- the playing venue: one operational fact about where the games happen. This
-- table is something else entirely -- the places a team wants to remember in
-- connection with a trip.
--
-- The context lives HERE rather than on the resource, because it describes one
-- trip and not the hotel. The same hotel is 'used' for Sparkler 2026 and
-- 'considered' for Sparkler 2027, and both remain true.
--
-- 'used' does NOT mean every family stayed there, that it was an official team
-- hotel, or that Season Tempo managed anything. It means the organization
-- wants to remember it.
create table if not exists tournament_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  tournament_id uuid not null references tournaments (id) on delete cascade,
  facility_id uuid not null references facilities (id) on delete cascade,
  context text not null default 'used',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  constraint tournament_resources_context_check
    check (context in ('used', 'recommended', 'considered')),
  -- One link per tournament and place. Re-linking updates the context rather
  -- than stacking duplicates.
  constraint tournament_resources_unique unique (tournament_id, facility_id)
);

comment on table tournament_resources is
  'Places an organization associates with a tournament: lodging, dining, or another facility. Deliberately NOT the playing venue, which stays on tournaments.facility_id. A link records that the organization wants to remember the place, never that everyone used it.';

create index if not exists idx_tournament_resources_tournament on tournament_resources (tournament_id);
-- Supports "which tournaments has this place been linked to", across seasons.
create index if not exists idx_tournament_resources_facility on tournament_resources (facility_id);

alter table tournament_resources enable row level security;

-- Same shape as every other org-scoped table here.
create policy "tournament_resources: org read" on tournament_resources
  for select using (organization_id = (select public.auth_organization_id()));

create policy "tournament_resources: org write" on tournament_resources
  for all
  using (organization_id = (select public.auth_organization_id())
         and (select public.auth_can_write()))
  with check (organization_id = (select public.auth_organization_id())
              and (select public.auth_can_write()));
