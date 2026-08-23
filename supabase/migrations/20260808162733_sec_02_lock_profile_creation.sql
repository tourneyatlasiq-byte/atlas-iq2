-- CRITICAL FIX: tenant isolation bypass.
--
-- The previous policy was `with check (id = auth.uid())` — it verified WHO you
-- are but never WHICH organization you were claiming or WHAT role you were
-- granting yourself. Any new signup could run:
--
--   insert into profiles (id, organization_id, role)
--   values (auth.uid(), '<any org uuid>', 'owner');
--
-- and immediately read that organization's players, birth certificates and
-- finances. Organization UUIDs are discoverable: facilities.created_by_
-- organization_id is readable by any authenticated user by design.
--
-- Direct client insertion is no longer the mechanism for joining anything.
-- Both paths now run through SECURITY DEFINER functions that decide the
-- organization and the role:
--
--   new organization     -> create_organization_setup()  -> owner
--   existing organization -> accept_invite()             -> role from the invite

drop policy if exists "profiles: user can create own" on profiles;

create policy "profiles: no direct insert" on profiles for insert
  with check (false);

comment on policy "profiles: no direct insert" on profiles is
  'Deliberately denies all direct inserts. Profiles are created only by
   create_organization_setup() or accept_invite(), which control organization
   and role. A permissive insert policy here is a tenant isolation bypass.';
