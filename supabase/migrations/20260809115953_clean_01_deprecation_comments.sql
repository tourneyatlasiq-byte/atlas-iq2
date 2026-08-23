-- Metadata only. Nothing is dropped and nothing changes at runtime.
--
-- These are read by no query in the application. Anyone reading the schema to
-- build Event Roster would reasonably assume they are live, so the schema now
-- says otherwise.

comment on table roster is
  'DEPRECATED. Superseded by players + team_season_players. Not read by the application.';

comment on column budget_items.actual is
  'DEPRECATED. Actual spend is derived from paid transactions linked to the line.';
comment on column budget_transactions.budgeted_amount is
  'DEPRECATED. Planned amounts live on budget_items.budgeted.';
comment on column player_payments.player_name is
  'DEPRECATED. Use player_id. Retained only for pre-link legacy rows.';
comment on column team_season_players.position is
  'DEPRECATED. Superseded by the positions array.';
comment on column facilities.notes is
  'DEPRECATED. Team-specific notes belong in organization_facilities.';
comment on column facilities.region is
  'DEPRECATED. Region was organization-specific judgement in a globally shared column.';
comment on column organizations.season is
  'DEPRECATED. Superseded by the seasons table.';
comment on column tournaments.location is
  'FALLBACK ONLY. Display derives from the linked facility. Used only where
   facility_id is null — four such rows remain and must not be cleared until
   each is linked to a canonical facility.';
