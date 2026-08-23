-- Facilities are canonical shared Atlas records: one row per real-world complex,
-- referenced by every organization and tournament. Only globally true facts live
-- here. Organization-specific knowledge goes in organization_facilities.

alter table facilities add column if not exists street_address text;
alter table facilities add column if not exists zip text;
alter table facilities add column if not exists latitude numeric(9,6);
alter table facilities add column if not exists longitude numeric(9,6);
alter table facilities add column if not exists website text;
alter table facilities add column if not exists field_count integer;
alter table facilities add column if not exists surface_type text;
alter table facilities add column if not exists external_place_id text;
alter table facilities add column if not exists external_source text;

alter table facilities drop constraint if exists facilities_surface_type_check;
alter table facilities add constraint facilities_surface_type_check
  check (surface_type is null or surface_type = any (array['Dirt','Turf','Mixed','Unknown']));

alter table facilities drop constraint if exists facilities_field_count_check;
alter table facilities add constraint facilities_field_count_check
  check (field_count is null or field_count >= 0);

-- Generated, so it can never drift from name. Used for duplicate detection only.
alter table facilities add column if not exists name_normalized text
  generated always as (lower(regexp_replace(coalesce(name,''), '[^a-zA-Z0-9]', '', 'g'))) stored;

create index if not exists idx_facilities_name_normalized on facilities (name_normalized);
create index if not exists idx_facilities_city_state on facilities (city, state);

-- External identity is only unique per provider. Partial so unmatched rows are unaffected.
drop index if exists idx_facilities_external_identity;
create unique index idx_facilities_external_identity
  on facilities (external_source, external_place_id)
  where external_place_id is not null and external_source is not null;

comment on column facilities.notes is
  'LEGACY. Organization-specific notes now live in organization_facilities.
   The Facilities module neither reads nor writes this column.';

comment on column facilities.region is
  'LEGACY. Region is an organization-specific grouping — different organizations
   describe the same geography differently — so it is not canonical facility data.
   Existing values retained; the Facilities module does not use them.';

comment on column facilities.name_normalized is
  'Generated: lowercased, alphanumerics only. Used to warn about likely duplicates
   when a same-city facility already exists. Deliberately NOT a unique constraint —
   distinct facilities can legitimately share a name in different towns.';

comment on column facilities.external_place_id is
  'Google Places / Mapbox identifier. Populated when external address search is
   enabled. Unique per external_source.';
