-- Tournament Board vertical slice: Facility becomes a real relationship
-- instead of free-typed text, per the "no duplicate data" rule.
-- Additive only — existing tournaments.location text is preserved as a
-- legacy fallback for old rows that predate this relationship.
alter table tournaments
  add column if not exists facility_id uuid references facilities(id) on delete set null;
