-- Statistics must reference the persistent player, not the deprecated roster
-- table. This is the premise the whole participation model rests on: a pickup
-- has no `roster` row, so under the old FK they could never have a stat.
--
-- Safe to do now and expensive later: player_stats has zero rows, and every
-- roster id is also a players id. Verified no code reads or writes this table.
--
-- ON DELETE CASCADE is kept deliberately. deletePlayerPermanently() already
-- exists as an intentional destructive action; RESTRICT would make it fail
-- once stats exist, which is worse.

alter table player_stats drop constraint player_stats_player_id_fkey;

alter table player_stats
  add constraint player_stats_player_id_fkey
  foreign key (player_id) references players(id) on delete cascade;

comment on column player_stats.player_id is
  'The persistent player. Statistics stay attached to the person across seasons
   and regardless of whether they were a roster member or a pickup.';
