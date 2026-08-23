-- Metadata-only demo rows: no backing storage object ever existed.
delete from documents where file_path like 'demo/%';

-- New entity relationships. One document row may surface in several modules
-- through these; the physical file is never duplicated.
alter table documents add column if not exists tournament_id uuid references tournaments(id) on delete set null;
alter table documents add column if not exists facility_id uuid references facilities(id) on delete set null;
alter table documents add column if not exists uploaded_by uuid references profiles(id) on delete set null;
alter table documents add column if not exists file_size integer;
alter table documents add column if not exists mime_type text;

-- REQUIRED for the category-sensitive storage policy. Without it, a coach could
-- insert a second metadata row pointing at an admin's birth certificate with a
-- permissive category, and the storage policy's lookup would grant access.
alter table documents drop constraint if exists documents_file_path_unique;
alter table documents add constraint documents_file_path_unique unique (file_path);

-- Category vocabulary. Medical is deliberately absent: Atlas does not store
-- medical records at this stage.
alter table documents drop constraint if exists documents_category_check;
alter table documents add constraint documents_category_check
  check (category = any (array[
    'Birth Certificate','Insurance','Sanctioning / Roster','Waiver',
    'Receipt','Team Form','Tournament Document','Other'
  ]));

alter table documents drop constraint if exists documents_file_size_check;
alter table documents add constraint documents_file_size_check
  check (file_size is null or (file_size > 0 and file_size <= 10485760));

alter table documents drop constraint if exists documents_mime_type_check;
alter table documents add constraint documents_mime_type_check
  check (mime_type is null or mime_type = any (array[
    'application/pdf','image/jpeg','image/png'
  ]));

-- Legacy misnamed FK: constrains organization_id, not team_id.
alter table documents rename constraint documents_team_id_fkey to documents_organization_id_fkey;

create index if not exists idx_documents_file_path on documents (file_path);
create index if not exists idx_documents_player on documents (player_id);
create index if not exists idx_documents_tournament on documents (tournament_id);
create index if not exists idx_documents_facility on documents (facility_id);
create index if not exists idx_documents_category on documents (category);

comment on column documents.file_path is
  'Canonical storage path: {organization_id}/{season_id|general}/{document_uuid}-{filename}.
   UNIQUE — this is a security control, not just hygiene. The storage policy resolves
   a category by looking up this path, so two rows for one object would allow
   category spoofing.';
