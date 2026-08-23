-- Whether this user has dismissed the Getting started card.
--
-- Per user rather than per organization: one coach hiding it should not hide
-- it for a manager who has not seen it yet. Deliberately a single boolean, not
-- an onboarding state model — the five steps derive from real data, so there
-- is no progress to store.
alter table profiles add column if not exists onboarding_hidden boolean not null default false;

comment on column profiles.onboarding_hidden is
  'User dismissed the Getting started card. Step completion is derived from
   actual data, so nothing else about onboarding is stored.';
