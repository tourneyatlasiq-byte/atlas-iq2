delete from team_season_players; -- roster-seed rows are not part of this fixture
-- LOCAL TEST FIXTURE ONLY. Fictional people. Org A has QAB, Org B does not.
insert into organizations (id, name) values ('a0000000-0000-0000-0000-000000000001','Org A (QAB)'), ('b0000000-0000-0000-0000-000000000001','Org B (no QAB)');
insert into seasons (id, team_id, name, phase) values
 ('5a000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','A current','current'),
 ('5b000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','B current','current');
insert into test_memberships values
 ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','coach'),
 ('10000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','parent'),
 ('10000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000001','coach');
insert into test_features values ('a0000000-0000-0000-0000-000000000001','qab');
-- twelve fictional players on Org A (p01..p12), one archived (p11), one coach row (p12), one on Org B (pb1)
insert into players (id, organization_id, full_name, person_type, archived_at)
select ('f0000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'a0000000-0000-0000-0000-000000000001',
       (array['Jordan Ellis','Maya Chen','Riley Stone','Avery Brooks','Casey Moreno','Taylor Reed','Sam Nolan','Lee Ortiz','Quinn Hart','Harper Whitfield','Emerson Okafor','Coach Dana Reyes'])[n],
       case when n = 12 then 'coach' else 'player' end, case when n = 11 then now() end
from generate_series(1, 12) n;
insert into players (id, organization_id, full_name) values ('f0000000-0000-0000-0000-0000000001b1','b0000000-0000-0000-0000-000000000001','Other Org Player');
-- active roster on season A: p01..p10 plus the archived one; p10 is a "pickup" via participants only (not on roster)
insert into team_season_players (team_id, season_id, player_id, jersey_number, is_active)
select 'a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001', ('f0000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, n + 1, true
from generate_series(1, 9) n;
insert into tournaments (id, organization_id, season_id, name) values
 ('c0000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','Fictional Classic');
insert into tournament_participants (tournament_id, player_id, jersey_number, participation) values
 ('c0000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-000000000110', 23, 'pickup');
insert into games (id, organization_id, season_id, tournament_id, opponent_name, game_date)
select ('9a000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'a0000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000a1','Opponent ' || n, date '2026-11-01' + n
from generate_series(1, 9) n;
insert into games (id, organization_id, season_id, opponent_name) values ('9b000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001','Org B opponent');

-- Org B has a normal roster; it simply lacks the QAB feature
insert into team_season_players (team_id, season_id, player_id, jersey_number, is_active) values
 ('b0000000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-0000000001b1', 7, true);
