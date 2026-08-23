insert into tournaments (id, organization_id, season_id, name, tournament_provider_id, facility_id,
                         start_date, end_date, location, entry_fee, gate_fee,
                         travel_type, decision, paid_status, placement)
values
  ('a71a5000-0000-0000-0000-000000000301','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',
   'Fall Kickoff Classic','21af6d87-5e3e-45a8-a4d5-637566ed595f','cc5bdbab-3dd0-48cd-a800-fc5120b9c057',
   '2026-09-12','2026-09-13','Woodstock, GA',495,60,'Local','Yes','Paid','3rd'),
  ('a71a5000-0000-0000-0000-000000000302','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',
   'Peach State Showdown','65332fea-b883-421c-84eb-5e473d690993','770b81d2-4491-4a3a-a3d5-40707bd016c3',
   '2026-10-03','2026-10-04','Marietta, GA',575,75,'Local','Yes','Paid','5th'),
  ('a71a5000-0000-0000-0000-000000000303','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',
   'Autumn Alliance Open','ec42873f-a60e-457d-9d44-84e6e06ca9c8','6b255f78-5222-469f-a5e3-05a2733c48ce',
   '2026-10-24','2026-10-25','Woodstock, GA',525,60,'Local','Yes','Unpaid',null),
  ('a71a5000-0000-0000-0000-000000000304','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',
   'Rome Fall Invitational','c236d48f-8637-41e2-a36c-ae68c8f9ebcf','1436b093-c141-438e-bb86-1f39df976ad8',
   '2026-11-07','2026-11-08','Rome, GA',650,80,'Regional','Maybe','Unpaid',null),
  ('a71a5000-0000-0000-0000-000000000305','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',
   'Winter Warm-Up','f40042d8-670b-4435-b21f-83fd7e220187','d045280f-8726-4869-81ad-305510b57cb5',
   '2027-01-16','2027-01-17','Cumming, GA',450,50,'Local','Maybe','Unpaid',null),
  ('a71a5000-0000-0000-0000-000000000306','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',
   'Triple Crown Spring Slam','fec6eb2e-0060-497e-b31c-965b432fb75b','1c8a4517-d214-4768-b294-5f5f2d9bb5f7',
   '2027-03-13','2027-03-14','Canton, GA',695,85,'Overnight','Yes','Deposit','1st'),
  ('a71a5000-0000-0000-0000-000000000307','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',
   'Atlanta Legacy Spring Championship','3f9ff9b6-e3ff-48b1-b980-b196f54ab639','4a9e1f29-f13e-4d4a-a7b8-8f5e8b4f51e6',
   '2027-04-17','2027-04-18','Dalton, GA',725,90,'Overnight','Maybe','Unpaid',null),
  ('a71a5000-0000-0000-0000-000000000308','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',
   'PGF Summer Qualifier','0be33b3b-4c42-4055-b710-5a714a460896','770b81d2-4491-4a3a-a3d5-40707bd016c3',
   '2027-06-19','2027-06-21','Marietta, GA',895,100,'Overnight','No','Unpaid',null);

insert into games (id, organization_id, season_id, tournament_id, game_date, opponent_name, result, runs_for, runs_against, game_type)
values
  ('a71a5000-0000-0000-0000-000000000401','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003','a71a5000-0000-0000-0000-000000000301','2026-09-12','Northside Thunder','W',7,3,'Pool'),
  ('a71a5000-0000-0000-0000-000000000402','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003','a71a5000-0000-0000-0000-000000000301','2026-09-12','Cobb Crush','L',2,5,'Pool'),
  ('a71a5000-0000-0000-0000-000000000403','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003','a71a5000-0000-0000-0000-000000000301','2026-09-13','Lake City Lightning','W',9,1,'Bracket'),
  ('a71a5000-0000-0000-0000-000000000404','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003','a71a5000-0000-0000-0000-000000000302','2026-10-03','Peachtree Force','W',5,4,'Pool'),
  ('a71a5000-0000-0000-0000-000000000405','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003','a71a5000-0000-0000-0000-000000000302','2026-10-04','Marietta Mavericks','L',3,6,'Bracket');

insert into player_payments (id, organization_id, season_id, player_id, initial_cost)
select
  ('a71a5000-0000-0000-0000-0000000005' || lpad((row_number() over (order by p.full_name))::text, 2, '0'))::uuid,
  'a71a5000-0000-0000-0000-000000000001',
  'a71a5000-0000-0000-0000-000000000003',
  p.id,
  2400
from players p
where p.organization_id = 'a71a5000-0000-0000-0000-000000000001';

insert into payment_log (id, payment_id, month_label, amount, paid_date)
select ('a71a5000-0000-0000-0000-0000000006' || lpad((row_number() over ())::text, 2, '0'))::uuid,
       pp.id, m.label, 200, m.pd
from player_payments pp
cross join (values ('Aug 2026','2026-08-05'::date), ('Sep 2026','2026-09-05'::date)) as m(label, pd)
where pp.organization_id = 'a71a5000-0000-0000-0000-000000000001';

insert into budget_transactions (id, organization_id, season_id, tournament_id, category, txn_date, vendor, item, quantity, budgeted_amount, actual_amount, status)
values
  ('a71a5000-0000-0000-0000-000000000701','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003','a71a5000-0000-0000-0000-000000000301','Entry Fees','2026-08-20','Top Flight','Fall Kickoff entry',1,495,495,'Paid'),
  ('a71a5000-0000-0000-0000-000000000702','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',null,'Uniforms','2026-08-01','Diamond Threads','Jersey set',12,1800,1740,'Received'),
  ('a71a5000-0000-0000-0000-000000000703','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',null,'Equipment','2026-08-14','Field Supply Co','Practice balls',6,240,265,'Paid'),
  ('a71a5000-0000-0000-0000-000000000704','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003','a71a5000-0000-0000-0000-000000000302','Entry Fees','2026-09-15','USA Softball','Peach State entry',1,575,575,'Paid'),
  ('a71a5000-0000-0000-0000-000000000705','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003','a71a5000-0000-0000-0000-000000000306','Travel','2027-02-20','Canton Inn','Team hotel block',8,1600,null,'Planned'),
  ('a71a5000-0000-0000-0000-000000000706','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',null,'Insurance','2026-08-01','Sports Cover','Season policy',1,350,350,'Paid');

insert into documents (id, organization_id, season_id, player_id, category, file_name, file_path, notes)
values
  ('a71a5000-0000-0000-0000-000000000801','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',null,'Insurance','2026-27-liability-policy.pdf','demo/insurance/policy.pdf','Season liability policy'),
  ('a71a5000-0000-0000-0000-000000000802','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003','a71a5000-0000-0000-0000-000000000101','Birth Certificate','alpha-birth-cert.pdf','demo/players/alpha-bc.pdf','On file'),
  ('a71a5000-0000-0000-0000-000000000803','a71a5000-0000-0000-0000-000000000001','a71a5000-0000-0000-0000-000000000003',null,'Other','2026-27-official-roster.pdf','demo/roster/official.pdf','Submitted to sanctioning body');
