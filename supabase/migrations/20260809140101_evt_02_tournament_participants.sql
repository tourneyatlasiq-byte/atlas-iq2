-- Event roster: who actually dressed for a tournament.
--
-- Distinct from the season roster, which is who belongs to the team this year.
-- Rostered players miss events; Atlas could not previously express that.
--
-- An empty event roster means "not recorded yet", never "everyone attended" —
-- which is why nothing auto-populates this table.

create table tournament_participants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id       uuid not null references seasons(id)       on delete cascade,
  tournament_id   uuid not null references tournaments(id)   on delete cascade,

  -- The persistent person. Deleting participation never deletes the player;
  -- only an explicit delete on players does that.
  player_id       uuid not null references players(id)       on delete cascade,

  -- How they took part, not who they are. A pickup this weekend may be a
  -- roster member next season, with one players row throughout.
  participation   text not null default 'roster'
                  check (participation in ('roster','pickup')),

  -- Event-specific. A pickup often wears whatever is spare, and it may differ
  -- per tournament. These never write back to team_season_players.
  jersey_number   integer,
  positions       text[],
  notes           text,

  -- Set by the trigger from auth.uid(), never trusted from the client.
  added_by        uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),

  unique (tournament_id, player_id)
);

create index idx_participants_tournament on tournament_participants (tournament_id);
create index idx_participants_player on tournament_participants (player_id);
create index idx_participants_pickup on tournament_participants (season_id)
  where participation = 'pickup';

comment on table tournament_participants is
  'Event roster — who dressed for a tournament. Interface name: "Event roster".
   Never auto-populated: an empty list means not recorded yet.';
