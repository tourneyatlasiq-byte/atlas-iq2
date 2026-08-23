-- Record of which version of which document a person accepted, and when.
--
-- Append-only, and deliberately not columns on profiles: columns can only hold
-- the most recent acceptance, so a version bump overwrites the only evidence
-- of what was previously agreed. If a question ever turns on which terms a
-- coach accepted, an overwritten column proves nothing.
--
-- Terms and Privacy are versioned separately because they will change at
-- different times.

create table terms_acceptances (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  document    text not null check (document in ('terms', 'privacy')),
  version     text not null,
  accepted_at timestamptz not null default now()
);

create index idx_terms_acceptances_profile on terms_acceptances (profile_id);
create unique index idx_terms_acceptances_unique
  on terms_acceptances (profile_id, document, version);

comment on table terms_acceptances is
  'Append-only record of accepted document versions. Never updated or deleted
   except by cascade when the profile is removed.';

alter table terms_acceptances enable row level security;

-- A person may read and create their own acceptances. Nobody may edit or
-- delete one — an audit record you can rewrite is not an audit record.
create policy "acceptances: read own" on terms_acceptances
  for select using (profile_id = auth.uid());

create policy "acceptances: create own" on terms_acceptances
  for insert with check (profile_id = auth.uid());
