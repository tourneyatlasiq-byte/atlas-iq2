-- PRIVILEGE ESCALATION FIX.
--
-- "profiles: user can update own" had USING (id = auth.uid()) and no WITH
-- CHECK. RLS cannot restrict columns, so "you may update your own row" meant
-- "you may change any field on your own row" — including role.
--
--   update profiles set role = 'owner' where id = auth.uid();
--
-- succeeded, which unlocked admin-only birth certificates, shared facility
-- editing, correction approval and facility deletion.
--
-- A user may edit their own name and preferences. Role and organization are
-- assigned to them; they are not theirs to choose.

drop policy if exists "profiles: user can update own" on profiles;

create policy "profiles: user can update own" on profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role is not distinct from (select p.role from profiles p where p.id = auth.uid())
    and organization_id is not distinct from
        (select p.organization_id from profiles p where p.id = auth.uid())
  );

comment on table profiles is
  'One row per user. A user may update their own full_name and preferences.
   role and organization_id are pinned by the update policy — changing either
   requires an administrator acting through a different path.';
