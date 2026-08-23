-- Fields required by the approved Overview / Registration / History sections.
-- All nullable: a tournament captured quickly should stay valid.

-- Overview
alter table tournaments add column if not exists age_division text;
alter table tournaments add column if not exists tournament_type text;
alter table tournaments add column if not exists guaranteed_games integer;

-- Registration
alter table tournaments add column if not exists registration_deadline date;

-- History (post-event evaluation)
alter table tournaments add column if not exists would_play_again boolean;
alter table tournaments add column if not exists overall_rating integer;
alter table tournaments add column if not exists history_notes text;

alter table tournaments drop constraint if exists tournaments_overall_rating_check;
alter table tournaments add constraint tournaments_overall_rating_check
  check (overall_rating is null or (overall_rating between 1 and 5));

alter table tournaments drop constraint if exists tournaments_guaranteed_games_check;
alter table tournaments add constraint tournaments_guaranteed_games_check
  check (guaranteed_games is null or guaranteed_games >= 0);

create index if not exists idx_tournaments_registration_deadline
  on tournaments (registration_deadline) where registration_deadline is not null;

comment on column tournaments.guaranteed_games is 'Games guaranteed by the provider, used when comparing value between events.';
comment on column tournaments.would_play_again is 'Post-event evaluation. Null means not yet evaluated.';
comment on column tournaments.overall_rating is 'Post-event evaluation, 1-5. Null means not yet rated.';
comment on column tournaments.history_notes is 'Post-event notes, kept separate from planning notes.';
comment on column tournaments.tournament_type is 'Free text for now (e.g. Pool Play, Bracket, Showcase, Qualifier). Not constrained pending an agreed value list.';
