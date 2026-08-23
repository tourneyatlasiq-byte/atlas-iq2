-- Beta decision: parents are not Season Tempo users.
--
-- The role stays in the profiles check constraint — removing it is migration
-- risk for no benefit, and a reserved value costs nothing. What changes is
-- that it can no longer be handed out: 'parent' is removed from the roles an
-- invitation may carry, so no parent account can be provisioned.
--
-- Read access was already nil. auth_can_write() excludes 'parent', and every
-- read policy resolves through auth_organization_id(), which returns nothing
-- for a profile with no writer role. Verified across 13 tables. This closes
-- the one remaining route: being invited in the first place.

alter table invites drop constraint if exists invites_role_check;

alter table invites
  add constraint invites_role_check
  check (role in ('coach', 'manager'));

comment on constraint invites_role_check on invites is
  'Beta: owners, admins, coaches and managers are the application users.
   ''parent'' is reserved in the profiles role list for a future phase and must
   be deliberately designed before it is activated — it is deliberately absent
   here so no parent account can be provisioned.';
