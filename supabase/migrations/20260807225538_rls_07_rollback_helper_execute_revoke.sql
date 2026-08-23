-- ROLLBACK of rls_06.
-- RLS policy expressions are evaluated with the privileges of the role running
-- the query, not the table owner. Revoking EXECUTE therefore broke every
-- policy that calls a helper. Restoring grants.
grant execute on function public.auth_organization_id() to anon, authenticated;
grant execute on function public.auth_org_role()        to anon, authenticated;
grant execute on function public.auth_is_org_admin()    to anon, authenticated;
grant execute on function public.auth_team_ids()        to anon, authenticated;
grant execute on function public.auth_season_ids()      to anon, authenticated;
grant execute on function public.auth_can_write()       to anon, authenticated;
