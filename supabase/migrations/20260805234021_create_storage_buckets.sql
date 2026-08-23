-- Team logos: public (fine for anyone with the link to see, like a team website)
insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do nothing;

-- Sensitive documents: private, never publicly readable
insert into storage.buckets (id, name, public)
values ('team-documents', 'team-documents', false)
on conflict (id) do nothing;

-- Anyone can view logos (public bucket)
create policy "Public can view team logos"
on storage.objects for select
using (bucket_id = 'team-logos');

-- Only coaches/managers of a team can upload/manage that team's logo.
-- Files are stored as: team-logos/{team_id}/logo.png
create policy "Coaches manage own team logo"
on storage.objects for all
using (
  bucket_id = 'team-logos'
  and (storage.foldername(name))[1] = (select team_id::text from profiles where id = auth.uid())
  and (select role from profiles where id = auth.uid()) in ('coach','manager')
);

-- Documents: only coaches/managers of the owning team can read or write.
-- Files are stored as: team-documents/{team_id}/...
create policy "Coaches manage own team documents"
on storage.objects for all
using (
  bucket_id = 'team-documents'
  and (storage.foldername(name))[1] = (select team_id::text from profiles where id = auth.uid())
  and (select role from profiles where id = auth.uid()) in ('coach','manager')
);
