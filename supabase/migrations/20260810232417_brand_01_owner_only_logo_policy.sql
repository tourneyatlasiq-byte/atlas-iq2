-- Organization branding is an owner decision.
--
-- The previous policy used auth_can_write(), which admits coach and manager —
-- roles that should be able to run a season but not change the club's
-- identity.
--
-- Written as owner-only, not owner-or-admin: 'admin' is permitted by the
-- profiles constraint but no profile in production uses it. Referencing a role
-- with no live instances would be writing a rule nobody can exercise.
--
-- Verified safe: the one organization with no owner (Georgia Power 2028) has
-- no members at all, so nobody could reach its branding either way.

drop policy if exists "team-logos: org writers manage" on storage.objects;

create policy "team-logos: owners manage"
  on storage.objects
  for all
  using (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = (select auth_organization_id())::text
    and (select role from profiles where id = auth.uid()) = 'owner'
  )
  with check (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = (select auth_organization_id())::text
    and (select role from profiles where id = auth.uid()) = 'owner'
  );
