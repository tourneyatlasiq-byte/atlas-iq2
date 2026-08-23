-- Historical-write hardening gap: documents and tournaments are season-scoped
-- (both carry season_id) but were missing the season_write_policy trigger that
-- the six other season-scoped tables carry. Verified exploitable 2026-08-10:
-- an INSERT into a season with atlas_season_phase() = 'past' succeeded on both.
-- Definition copied verbatim from budget_items / games.

drop trigger if exists season_write_policy on public.documents;
create trigger season_write_policy
  before insert or delete or update on public.documents
  for each row execute function enforce_season_write_policy('season_id');

drop trigger if exists season_write_policy on public.tournaments;
create trigger season_write_policy
  before insert or delete or update on public.tournaments
  for each row execute function enforce_season_write_policy('season_id');
