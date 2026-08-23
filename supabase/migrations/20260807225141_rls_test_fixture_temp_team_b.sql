-- TEMPORARY isolation-test fixture. Removed after tests.
-- Team B lives in the SAME organization as Team A — that is the whole point.

insert into teams (id, organization_id, name) values
  ('b0000000-0000-0000-0000-00000000000b','a71a5000-0000-0000-0000-000000000001','TEMP TEST Team B 14U');

insert into seasons (id, team_id, name, start_date, end_date, is_current) values
  ('b0000000-0000-0000-0000-0000000000cc','b0000000-0000-0000-0000-00000000000b','TEMP 2026-27 B','2026-08-01','2027-07-31',false);

insert into tournaments (id, organization_id, season_id, name, start_date, end_date, entry_fee, gate_fee, decision)
values ('b0000000-0000-0000-0000-0000000000d1','a71a5000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-0000000000cc','TEMP Team B Tournament','2026-09-19','2026-09-20',400,50,'Yes');

insert into games (id, organization_id, season_id, tournament_id, game_date, opponent_name, result, runs_for, runs_against)
values ('b0000000-0000-0000-0000-0000000000d2','a71a5000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-0000000000cc','b0000000-0000-0000-0000-0000000000d1','2026-09-19','TEMP Opponent','W',4,2);

insert into players (id, organization_id, full_name, person_type)
values ('b0000000-0000-0000-0000-0000000000d3','a71a5000-0000-0000-0000-000000000001','TEMP Team B Player','player');

insert into team_season_players (id, player_id, team_id, season_id, jersey_number)
values ('b0000000-0000-0000-0000-0000000000d4','b0000000-0000-0000-0000-0000000000d3','b0000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-0000000000cc',99);

insert into player_payments (id, organization_id, season_id, player_id, initial_cost)
values ('b0000000-0000-0000-0000-0000000000d5','a71a5000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-0000000000cc','b0000000-0000-0000-0000-0000000000d3',1500);

insert into documents (id, organization_id, season_id, category, file_name, file_path)
values ('b0000000-0000-0000-0000-0000000000d6','a71a5000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-0000000000cc','Other','TEMP-team-b-doc.pdf','demo/temp/b.pdf');

-- Second organization, to prove the outer boundary holds.
insert into organizations (id, name) values
  ('c0000000-0000-0000-0000-00000000000c','TEMP TEST Other Org');
insert into teams (id, organization_id, name) values
  ('c0000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-00000000000c','TEMP Other Org Team');
insert into seasons (id, team_id, name, start_date, end_date, is_current) values
  ('c0000000-0000-0000-0000-0000000000c2','c0000000-0000-0000-0000-0000000000c1','TEMP Other Season','2026-08-01','2027-07-31',true);
insert into tournaments (id, organization_id, season_id, name, start_date, end_date, entry_fee, gate_fee, decision)
values ('c0000000-0000-0000-0000-0000000000c3','c0000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-0000000000c2','TEMP Other Org Tournament','2026-10-10','2026-10-11',300,40,'Yes');
