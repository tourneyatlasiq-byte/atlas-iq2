-- Clean, disposable demo dataset for application testing.
-- All ids prefixed a71a5... ("atlas") so the whole set can be removed in one statement later.
-- Legacy Georgia Power data is left completely untouched.

insert into organizations (id, name) values
  ('a71a5000-0000-0000-0000-000000000001', 'Atlas Demo Softball');

insert into teams (id, organization_id, name, is_placeholder_name) values
  ('a71a5000-0000-0000-0000-000000000002', 'a71a5000-0000-0000-0000-000000000001', 'Atlas Demo 16U', false);

insert into seasons (id, team_id, name, start_date, end_date, is_current, is_placeholder) values
  ('a71a5000-0000-0000-0000-000000000003', 'a71a5000-0000-0000-0000-000000000002',
   '2026-27', '2026-08-01', '2027-07-31', true, false);

-- 12 players. NATO-alphabet surnames make the set unmistakably synthetic
-- while still rendering naturally in the UI.
insert into players (id, organization_id, full_name, person_type, grad_year, date_of_birth, parent_email, parent_phone)
values
  ('a71a5000-0000-0000-0000-000000000101','a71a5000-0000-0000-0000-000000000001','Ava Alpha','player',2029,'2011-03-14','alpha.parent@atlasdemo.test','555-0101'),
  ('a71a5000-0000-0000-0000-000000000102','a71a5000-0000-0000-0000-000000000001','Bella Bravo','player',2029,'2011-05-02','bravo.parent@atlasdemo.test','555-0102'),
  ('a71a5000-0000-0000-0000-000000000103','a71a5000-0000-0000-0000-000000000001','Cora Charlie','player',2028,'2010-09-21','charlie.parent@atlasdemo.test','555-0103'),
  ('a71a5000-0000-0000-0000-000000000104','a71a5000-0000-0000-0000-000000000001','Delia Delta','player',2029,'2011-01-08','delta.parent@atlasdemo.test','555-0104'),
  ('a71a5000-0000-0000-0000-000000000105','a71a5000-0000-0000-0000-000000000001','Elle Echo','player',2028,'2010-11-30','echo.parent@atlasdemo.test','555-0105'),
  ('a71a5000-0000-0000-0000-000000000106','a71a5000-0000-0000-0000-000000000001','Faye Foxtrot','player',2029,'2011-07-17','foxtrot.parent@atlasdemo.test','555-0106'),
  ('a71a5000-0000-0000-0000-000000000107','a71a5000-0000-0000-0000-000000000001','Gia Golf','player',2028,'2010-04-25','golf.parent@atlasdemo.test','555-0107'),
  ('a71a5000-0000-0000-0000-000000000108','a71a5000-0000-0000-0000-000000000001','Hana Hotel','player',2029,'2011-02-11','hotel.parent@atlasdemo.test','555-0108'),
  ('a71a5000-0000-0000-0000-000000000109','a71a5000-0000-0000-0000-000000000001','Iris India','player',2028,'2010-08-03','india.parent@atlasdemo.test','555-0109'),
  ('a71a5000-0000-0000-0000-000000000110','a71a5000-0000-0000-0000-000000000001','Jada Juliet','player',2029,'2011-06-19','juliet.parent@atlasdemo.test','555-0110'),
  ('a71a5000-0000-0000-0000-000000000111','a71a5000-0000-0000-0000-000000000001','Kira Kilo','player',2028,'2010-12-07','kilo.parent@atlasdemo.test','555-0111'),
  ('a71a5000-0000-0000-0000-000000000112','a71a5000-0000-0000-0000-000000000001','Lena Lima','player',2029,'2011-10-28','lima.parent@atlasdemo.test','555-0112');

-- Season roster assignments
insert into team_season_players (id, player_id, team_id, season_id, jersey_number, jersey_size, pants_size, position)
select
  ('a71a5000-0000-0000-0000-0000000002' || lpad((row_number() over (order by p.full_name))::text, 2, '0'))::uuid,
  p.id,
  'a71a5000-0000-0000-0000-000000000002',
  'a71a5000-0000-0000-0000-000000000003',
  v.jersey, v.jsize, v.psize, v.pos
from players p
join (values
  ('Ava Alpha', 1,'YL','YL','P'),      ('Bella Bravo', 4,'AS','AS','C'),
  ('Cora Charlie', 7,'AM','AM','1B'),  ('Delia Delta', 9,'YL','YL','2B'),
  ('Elle Echo', 11,'AS','AS','3B'),    ('Faye Foxtrot', 12,'AM','AM','SS'),
  ('Gia Golf', 14,'AS','AS','LF'),     ('Hana Hotel', 17,'YL','YL','CF'),
  ('Iris India', 21,'AM','AM','RF'),   ('Jada Juliet', 23,'AS','AS','P'),
  ('Kira Kilo', 27,'AM','AM','UTIL'),  ('Lena Lima', 32,'YL','YL','C')
) as v(name, jersey, jsize, psize, pos) on v.name = p.full_name
where p.organization_id = 'a71a5000-0000-0000-0000-000000000001';
