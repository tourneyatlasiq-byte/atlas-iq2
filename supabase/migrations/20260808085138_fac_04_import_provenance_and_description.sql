-- Two fields the facility import CSV needs somewhere to put.
--
-- These are deliberately NOT facilities.notes, which was retired because it
-- held organization-specific content. Both of these are globally true facts
-- about the canonical record.

-- Where this record came from: "USA Softball GA list", "manual", "PGF 2027".
-- Makes a bad import reversible and lets us audit a seeded master list.
alter table facilities add column if not exists data_source text;

-- Public, globally true description of the complex. Organization-specific
-- knowledge still belongs in organization_facilities.
alter table facilities add column if not exists description text;

create index if not exists idx_facilities_data_source on facilities (data_source);

comment on column facilities.data_source is
  'Provenance of the canonical record — which import or list it came from.
   Global metadata, not organization-specific.';

comment on column facilities.description is
  'Public description of the complex. Globally true facts only; organization
   experience belongs in organization_facilities. Distinct from the retired
   facilities.notes column.';
