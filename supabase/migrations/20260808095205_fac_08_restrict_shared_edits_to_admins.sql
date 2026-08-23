-- Shared facility facts are canonical Atlas data. A coach editing them changes
-- the record for every organization, so direct edits are limited to the
-- creating organization's owner/admin. Everyone else suggests corrections.
--
-- SELECT and INSERT are unchanged: any authenticated user reads, any writer
-- may add a new facility.

drop policy if exists "facilities: creating org modify" on facilities;
create policy "facilities: creating org admin modify" on facilities for update
  using      (created_by_organization_id = (select auth_organization_id())
              and (select auth_is_org_admin()))
  with check (created_by_organization_id = (select auth_organization_id())
              and (select auth_is_org_admin()));

drop policy if exists "facilities: creating org delete" on facilities;
create policy "facilities: creating org admin delete" on facilities for delete
  using (created_by_organization_id = (select auth_organization_id())
         and (select auth_is_org_admin()));
