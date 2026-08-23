-- Documents table: existing season/organization scope, plus a category gate.
-- Birth Certificates are admin-only for the full lifecycle, so a coach cannot
-- even see that such a row exists — which removes any route to reading
-- file_path and attacking storage directly.

drop policy if exists "documents: season read" on documents;
create policy "documents: season read" on documents for select
  using (
    (season_id in (select auth_season_ids())
     or (season_id is null and organization_id = (select auth_organization_id())))
    and (category <> 'Birth Certificate' or (select auth_is_org_admin()))
  );

drop policy if exists "documents: season write" on documents;
create policy "documents: season write" on documents for all
  using (
    (season_id in (select auth_season_ids())
     or (season_id is null and organization_id = (select auth_organization_id())))
    and (select auth_can_write())
    and (category <> 'Birth Certificate' or (select auth_is_org_admin()))
  )
  with check (
    (season_id in (select auth_season_ids())
     or (season_id is null and organization_id = (select auth_organization_id())))
    and (select auth_can_write())
    -- WITH CHECK on the NEW row blocks recategorizing INTO Birth Certificate;
    -- USING on the OLD row blocks recategorizing OUT of it.
    and (category <> 'Birth Certificate' or (select auth_is_org_admin()))
  );
