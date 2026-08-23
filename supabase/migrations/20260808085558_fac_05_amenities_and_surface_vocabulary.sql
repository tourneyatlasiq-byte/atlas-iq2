-- Surface vocabulary: Dirt -> Grass.
-- For softball the meaningful distinction is natural grass vs artificial turf;
-- "Dirt" reads as a skinned infield, which is not what the field records.
alter table facilities drop constraint if exists facilities_surface_type_check;
update facilities set surface_type = 'Grass' where surface_type = 'Dirt';
alter table facilities add constraint facilities_surface_type_check
  check (surface_type is null or surface_type = any (array['Grass','Turf','Mixed','Unknown']));

alter table facilities add column if not exists county text;

-- Amenities. All nullable three-state booleans: true / false / null.
-- Null means "we don't know", which is NOT the same as "no" — an unknown
-- amenity must never be reported as absent.
alter table facilities add column if not exists indoor boolean;
alter table facilities add column if not exists lights boolean;
alter table facilities add column if not exists batting_cages boolean;
alter table facilities add column if not exists concessions boolean;
alter table facilities add column if not exists restrooms boolean;
alter table facilities add column if not exists playground boolean;

-- Global parking facts (capacity, cost). Organization experience of parking
-- still belongs in organization_facilities.parking_notes.
alter table facilities add column if not exists parking text;

create index if not exists idx_facilities_county on facilities (county);

comment on column facilities.surface_type is
  'Grass | Turf | Mixed | Unknown. Natural grass vs artificial turf.';

comment on column facilities.concessions is
  'Whether the venue HAS concessions — a global fact. An organization''s
   experience of them belongs in organization_facilities.concessions_notes.';

comment on column facilities.parking is
  'Global parking facts: capacity, cost, lot layout. Organization experience
   ("north lot fills by 8am") belongs in organization_facilities.parking_notes.';

comment on column facilities.indoor is
  'Three-state: true / false / null. Null means unknown, never "no".';
