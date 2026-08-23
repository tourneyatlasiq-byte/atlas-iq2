-- Remove all temporary isolation-test records and restore account state.
delete from team_memberships where id = 'd0000000-0000-0000-0000-0000000000e1';

delete from documents            where season_id = 'b0000000-0000-0000-0000-0000000000cc';
delete from payment_log          where payment_id in (select id from player_payments where season_id = 'b0000000-0000-0000-0000-0000000000cc');
delete from player_payments      where season_id = 'b0000000-0000-0000-0000-0000000000cc';
delete from team_season_players  where season_id = 'b0000000-0000-0000-0000-0000000000cc';
delete from games                where season_id = 'b0000000-0000-0000-0000-0000000000cc';
delete from tournaments          where season_id = 'b0000000-0000-0000-0000-0000000000cc';
delete from players              where id = 'b0000000-0000-0000-0000-0000000000d3';
delete from seasons              where id = 'b0000000-0000-0000-0000-0000000000cc';
delete from teams                where id = 'b0000000-0000-0000-0000-00000000000b';

delete from tournaments where season_id = 'c0000000-0000-0000-0000-0000000000c2';
delete from seasons     where id = 'c0000000-0000-0000-0000-0000000000c2';
delete from teams       where id = 'c0000000-0000-0000-0000-0000000000c1';
delete from organizations where id = 'c0000000-0000-0000-0000-00000000000c';

-- Both accounts return to owner.
update profiles set role = 'owner';
