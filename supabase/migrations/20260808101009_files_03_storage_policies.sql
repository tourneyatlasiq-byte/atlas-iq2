-- The previous policy permitted only coach/manager, locking out owner and
-- admin entirely — nobody could use files at all. Replaced with two layers:
--
--   Layer 1  organization boundary, read from the path. Holds even if the
--            metadata row is missing.
--   Layer 2  category sensitivity, resolved by looking up documents.file_path.
--            Safe only because file_path is UNIQUE.

drop policy if exists "Coaches manage own team documents" on storage.objects;

create policy "team-documents: read permitted categories"
on storage.objects for select to authenticated
using (
  bucket_id = 'team-documents'
  and (storage.foldername(name))[1] = (select public.auth_organization_id())::text
  and (
    (select public.auth_is_org_admin())
    or coalesce(
         (select d.category from public.documents d where d.file_path = storage.objects.name),
         'Other'
       ) <> 'Birth Certificate'
  )
);

create policy "team-documents: writers upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'team-documents'
  and (storage.foldername(name))[1] = (select public.auth_organization_id())::text
  and (select public.auth_can_write())
);

create policy "team-documents: update permitted categories"
on storage.objects for update to authenticated
using (
  bucket_id = 'team-documents'
  and (storage.foldername(name))[1] = (select public.auth_organization_id())::text
  and (
    (select public.auth_is_org_admin())
    or coalesce(
         (select d.category from public.documents d where d.file_path = storage.objects.name),
         'Other'
       ) <> 'Birth Certificate'
  )
);

create policy "team-documents: delete permitted categories"
on storage.objects for delete to authenticated
using (
  bucket_id = 'team-documents'
  and (storage.foldername(name))[1] = (select public.auth_organization_id())::text
  and (
    (select public.auth_is_org_admin())
    or coalesce(
         (select d.category from public.documents d where d.file_path = storage.objects.name),
         'Other'
       ) <> 'Birth Certificate'
  )
);

-- team-logos stays public and coach-manageable, but must never receive
-- documents. The Files server action hardcodes the bucket so the client can
-- never choose it.
drop policy if exists "Coaches manage own team logo" on storage.objects;
create policy "team-logos: org writers manage"
on storage.objects for all to authenticated
using (
  bucket_id = 'team-logos'
  and (storage.foldername(name))[1] = (select public.auth_organization_id())::text
  and (select public.auth_can_write())
)
with check (
  bucket_id = 'team-logos'
  and (storage.foldername(name))[1] = (select public.auth_organization_id())::text
  and (select public.auth_can_write())
);
