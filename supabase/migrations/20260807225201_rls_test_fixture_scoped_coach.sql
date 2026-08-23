-- TEMPORARY. Uses the second real auth user as a Team-A-only coach.
update profiles set role = 'coach' where id = '6452ca9a-aaed-4e28-9dc1-e2f3aa6c058b';

insert into team_memberships (id, profile_id, team_id, role) values
  ('d0000000-0000-0000-0000-0000000000e1',
   '6452ca9a-aaed-4e28-9dc1-e2f3aa6c058b',
   'a71a5000-0000-0000-0000-000000000002',
   'coach');
