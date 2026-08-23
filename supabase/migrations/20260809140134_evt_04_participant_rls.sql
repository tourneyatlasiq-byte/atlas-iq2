-- Same shape as games: read anything in an accessible season, write only with
-- writer permission. Parent is excluded because auth_can_write() excludes it.
--
-- RLS governs who and which tenant. enforce_participant_integrity() governs
-- whether the row is internally coherent.

alter table tournament_participants enable row level security;

create policy "participants: season read" on tournament_participants
  for select
  using (season_id in (select auth_season_ids()));

create policy "participants: season write" on tournament_participants
  for all
  using (
    season_id in (select auth_season_ids())
    and (select auth_can_write())
  )
  with check (
    season_id in (select auth_season_ids())
    and (select auth_can_write())
  );
