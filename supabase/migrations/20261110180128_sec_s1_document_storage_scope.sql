-- sec_s1: file storage follows the documents rules (2026-11).
--
-- Gap: the team-documents storage rules checked only the organization folder
-- and the birth-certificate category. Through the app a coach could only reach
-- files of teams they are assigned to (the app reads the documents row first),
-- but with their own session they could list, download, update or delete any
-- non-birth-certificate file in their organization's folder by calling the
-- storage API directly — including another team's files.
--
-- Fix: a stored file is reachable only if the caller can see its documents row.
-- can_access_document_file() runs with the caller's own permissions (SECURITY
-- INVOKER), so it obeys every rule already on documents — organization,
-- season/team, birth-certificate category, parent links — and any future one,
-- without copying them here. Writes additionally require write access, as
-- before. The existing organization-folder and category checks stay as extra
-- layers.
--
-- Signed-in only (as before): the rules apply to the authenticated role, like
-- the rules they replace. Signed-out requests never evaluate them and see no
-- files, rather than failing on the signed-in-only check function.
--
-- Upload flow is unchanged: the server creates the documents row first, then the
-- browser uploads to that exact path. Objects with no documents row (2 orphaned
-- files today) become unreachable; nothing is deleted.

create or replace function public.can_access_document_file(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (select 1 from public.documents d where d.file_path = p_name)
$$;

comment on function public.can_access_document_file(text) is
  'sec_s1: true when the caller can see the documents row for this storage path. SECURITY INVOKER: documents RLS decides.';

revoke all on function public.can_access_document_file(text) from public, anon;
grant execute on function public.can_access_document_file(text) to authenticated;

drop policy if exists "team-documents: read permitted categories" on storage.objects;
drop policy if exists "team-documents: update permitted categories" on storage.objects;
drop policy if exists "team-documents: delete permitted categories" on storage.objects;
drop policy if exists "team-documents: writers upload" on storage.objects;

create policy "team-documents: read files you can see"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'team-documents'
    and (storage.foldername(name))[1] = (select auth_organization_id())::text
    and public.can_access_document_object(name)
    and public.can_access_document_file(name)
  );

create policy "team-documents: update files you can see"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'team-documents'
    and (storage.foldername(name))[1] = (select auth_organization_id())::text
    and public.can_access_document_object(name)
    and public.can_access_document_file(name)
    and (select auth_can_write())
  );

create policy "team-documents: delete files you can see"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'team-documents'
    and (storage.foldername(name))[1] = (select auth_organization_id())::text
    and public.can_access_document_object(name)
    and public.can_access_document_file(name)
    and (select auth_can_write())
  );

create policy "team-documents: upload to your file record"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'team-documents'
    and (storage.foldername(name))[1] = (select auth_organization_id())::text
    and public.can_access_document_file(name)
    and (select auth_can_write())
  );
