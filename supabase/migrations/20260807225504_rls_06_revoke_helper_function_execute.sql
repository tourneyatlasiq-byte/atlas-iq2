-- Helper functions are internal to RLS policy evaluation. They should not be
-- reachable as REST RPC endpoints. Policies are evaluated with the table
-- owner's privileges, so revoking EXECUTE from client roles does not affect
-- policy enforcement.
revoke execute on function public.auth_organization_id() from anon, authenticated, public;
revoke execute on function public.auth_org_role()        from anon, authenticated, public;
revoke execute on function public.auth_is_org_admin()    from anon, authenticated, public;
revoke execute on function public.auth_team_ids()        from anon, authenticated, public;
revoke execute on function public.auth_season_ids()      from anon, authenticated, public;
revoke execute on function public.auth_can_write()       from anon, authenticated, public;
