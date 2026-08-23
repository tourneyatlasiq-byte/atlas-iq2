-- Canonical detail for the shared facilities. These are real complexes, so the
-- data is globally true and belongs on the shared record.
update facilities set street_address='1082 Al Bishop Dr', zip='30008', field_count=6, surface_type='Dirt',
  latitude=33.917200, longitude=-84.598900
  where id='770b81d2-4491-4a3a-a3d5-40707bd016c3';

update facilities set street_address='7345 Cumming Hwy', zip='30115', field_count=5, surface_type='Mixed',
  latitude=34.209800, longitude=-84.462100
  where id='1c8a4517-d214-4768-b294-5f5f2d9bb5f7';

update facilities set street_address='1425 Heritage Point Dr', zip='30720', field_count=4, surface_type='Turf',
  latitude=34.780900, longitude=-84.977400
  where id='4a9e1f29-f13e-4d4a-a7b8-8f5e8b4f51e6';

update facilities set street_address='6688 Bells Ferry Rd', zip='30189', field_count=8, surface_type='Mixed',
  latitude=34.128600, longitude=-84.529700
  where id='cc5bdbab-3dd0-48cd-a800-fc5120b9c057';

update facilities set street_address='210 JJ Biello Dr', zip='30188', field_count=4, surface_type='Dirt',
  latitude=34.101300, longitude=-84.481900
  where id='6b255f78-5222-469f-a5e3-05a2733c48ce';

update facilities set street_address='755 Braves Blvd', zip='30161', field_count=1, surface_type='Turf',
  latitude=34.246800, longitude=-85.157300
  where id='1436b093-c141-438e-bb86-1f39df976ad8';

update facilities set street_address='1950 Sharon Rd', zip='30041', field_count=5, surface_type='Unknown',
  latitude=34.191400, longitude=-84.115600
  where id='d045280f-8726-4869-81ad-305510b57cb5';

-- Atlas Demo's own operational notes on three of them.
insert into organization_facilities
  (organization_id, facility_id, parking_notes, entry_notes, concessions_notes, restroom_notes, seating_notes, internal_notes)
values
  ('a71a5000-0000-0000-0000-000000000001','cc5bdbab-3dd0-48cd-a800-fc5120b9c057',
   'North lot fills by 8am. Overflow across Bells Ferry.',
   'Gate fee per person, cash only. Wristbands last all weekend.',
   'Full concession stand, opens 30 min before first pitch.',
   'Permanent restrooms behind fields 3 and 4.',
   'Metal bleachers, almost no shade. Bring canopies.',
   'Our home complex. Fields 5-8 are the tournament fields.'),
  ('a71a5000-0000-0000-0000-000000000001','770b81d2-4491-4a3a-a3d5-40707bd016c3',
   'Large paved lot, rarely fills.',
   'Single entry at the main gate.',
   'Concessions on the hill between fields 2 and 3.',
   'Clean, well maintained.',
   'Some shaded seating along the third base lines.',
   'Long walk between the outer fields — allow extra time.'),
  ('a71a5000-0000-0000-0000-000000000001','1436b093-c141-438e-bb86-1f39df976ad8',
   'Stadium lot, $5 per car.',
   'Enter through the main stadium gate only.',
   'Full stadium concessions.',
   'Stadium restrooms.',
   'Covered stadium seating. Best venue we play.',
   'Single field. Championship games only.');
