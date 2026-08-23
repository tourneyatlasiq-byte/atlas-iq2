-- SECURITY FIX.
--
-- The previous storage policies resolved a document's category with an inline
-- subquery against `documents`. That subquery runs under the CALLER's RLS — so
-- a coach, who cannot see Birth Certificate rows, got NULL back, coalesce()
-- turned it into 'Other', and the sensitive object became readable.
--
-- Hiding the metadata row is exactly what made the storage gate fail open.
--
-- The lookup must bypass RLS. SECURITY DEFINER does that, and returns only a
-- category string for a path the caller already knows.

create or replace function public.document_category_for_path(object_path text)
returns text language sql stable security definer set search_path to 'public' as $$
  select d.category from documents d where d.file_path = object_path;
$$;

comment on function public.document_category_for_path(text) is
  'Resolves a storage object''s document category, bypassing RLS.
   Used by storage policies: an RLS-filtered lookup fails OPEN for users who
   cannot see the sensitive row. Returns null when no metadata exists.';

grant execute on function public.document_category_for_path(text) to authenticated;

-- Objects with no metadata row are treated as sensitive, not permissive. The
-- upload flow always inserts metadata before uploading, so an orphan is an
-- anomaly and should not be readable by non-admins.
create or replace function public.can_access_document_object(object_path text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select public.auth_is_org_admin())
      or coalesce(public.document_category_for_path(object_path), 'Birth Certificate')
         <> 'Birth Certificate',
    false
  );
$$;

grant execute on function public.can_access_document_object(text) to authenticated;

drop policy if exists "team-documents: read permitted categories" on storage.objects;
create policy "team-documents: read permitted categories"
on storage.objects for select to authenticated
using (
  bucket_id = 'team-documents'
  and (storage.foldername(name))[1] = (select public.auth_organization_id())::text
  and public.can_access_document_object(name)
);

drop policy if exists "team-documents: update permitted categories" on storage.objects;
create policy "team-documents: update permitted categories"
on storage.objects for update to authenticated
using (
  bucket_id = 'team-documents'
  and (storage.foldername(name))[1] = (select public.auth_organization_id())::text
  and public.can_access_document_object(name)
);

drop policy if exists "team-documents: delete permitted categories" on storage.objects;
create policy "team-documents: delete permitted categories"
on storage.objects for delete to authenticated
using (
  bucket_id = 'team-documents'
  and (storage.foldername(name))[1] = (select public.auth_organization_id())::text
  and public.can_access_document_object(name)
);
