-- Organization-level roles. owner/admin see all teams; coach/manager are
-- scoped through team_memberships; parent is read-limited (UI later).
alter table profiles drop constraint if exists profiles_role_check;

alter table profiles add constraint profiles_role_check
  check (role = any (array['owner','admin','coach','manager','parent']));

-- Deny by default: a coach with no team_memberships sees nothing.
-- Existing accounts are the organization owner, so make that explicit.
update profiles set role = 'owner';

-- Rename the misleading FK left over from v1 (it constrains organization_id).
alter table profiles rename constraint profiles_team_id_fkey to profiles_organization_id_fkey;
