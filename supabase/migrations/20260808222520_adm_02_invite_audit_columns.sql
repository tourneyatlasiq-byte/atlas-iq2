-- Invite auditability. Added now, while there are zero invites — once a real
-- coach has accepted one, changing delete-to-mark means reasoning about rows
-- that no longer exist.
alter table invites add column if not exists accepted_at timestamptz;
alter table invites add column if not exists accepted_by uuid references profiles(id) on delete set null;
alter table invites add column if not exists expires_at timestamptz not null default (now() + interval '14 days');
alter table invites add column if not exists created_by uuid references profiles(id) on delete set null;

create index if not exists idx_invites_org_pending on invites (organization_id) where accepted_at is null;
create index if not exists idx_invites_email on invites (lower(email));

comment on column invites.accepted_at is
  'Set when the invitation is used. Accepted invites are retained, not deleted,
   so there is a record of who joined and when.';
comment on column invites.expires_at is
  'Default 14 days. accept_invite() refuses an expired invitation.';

-- The invited person may read and delete their own invitation, but must never
-- be able to rewrite the organization, role or team it grants.
drop policy if exists "invites: invited user can update own" on invites;
create policy "invites: invited user cannot modify" on invites for update
  using (
    organization_id = (select auth_organization_id())
    and (select auth_is_org_admin())
  )
  with check (
    organization_id = (select auth_organization_id())
    and (select auth_is_org_admin())
  );
