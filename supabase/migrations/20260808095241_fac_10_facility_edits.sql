-- One table for direct edits, suggestions, approvals, rejections and audit
-- history. Two tables would mean copying approved suggestions into a log, and
-- any copy step is a place for history to drift from reality.
--
-- Organization-private notes can never appear here: this table only ever
-- references columns on `facilities`. That is structural, not a filter someone
-- could forget to apply.

create table if not exists facility_edits (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  field_name text not null,
  -- Stored as text whatever the underlying column type: an audit log renders
  -- what changed, it does not re-typecheck it.
  current_value text,
  proposed_value text,
  status text not null default 'pending'
    check (status in ('pending','applied','rejected','superseded')),
  change_type text not null
    check (change_type in ('direct','suggestion')),
  source_reference text,
  submitted_by uuid references profiles(id) on delete set null,
  submitted_by_organization_id uuid references organizations(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text
);

create index if not exists idx_facility_edits_facility on facility_edits (facility_id, status);
create index if not exists idx_facility_edits_pending on facility_edits (status) where status = 'pending';
create index if not exists idx_facility_edits_submitter on facility_edits (submitted_by_organization_id);

alter table facility_edits enable row level security;

-- Applied changes are public history across organizations. Pending and
-- rejected rows are visible only to the submitting organization and to the
-- curating organization that has to review them.
drop policy if exists "facility_edits: read" on facility_edits;
create policy "facility_edits: read" on facility_edits for select
  using (
    status = 'applied'
    or submitted_by_organization_id = (select auth_organization_id())
    or (select auth_organization_id()) =
       (select f.created_by_organization_id from facilities f where f.id = facility_id)
  );

-- The security-critical clause. Without the status constraint a coach could
-- insert status='applied' and bypass review entirely.
drop policy if exists "facility_edits: submit" on facility_edits;
create policy "facility_edits: submit" on facility_edits for insert
  with check (
    (select auth_can_write())
    and submitted_by_organization_id = (select auth_organization_id())
    and (
      (change_type = 'suggestion' and status = 'pending')
      or (
        change_type = 'direct'
        and status = 'applied'
        and (select auth_is_org_admin())
        and (select auth_organization_id()) =
            (select f.created_by_organization_id from facilities f where f.id = facility_id)
      )
    )
  );

-- Only the curating organization's admin approves or rejects.
drop policy if exists "facility_edits: review" on facility_edits;
create policy "facility_edits: review" on facility_edits for update
  using (
    (select auth_is_org_admin())
    and (select auth_organization_id()) =
        (select f.created_by_organization_id from facilities f where f.id = facility_id)
  )
  with check (
    (select auth_is_org_admin())
    and (select auth_organization_id()) =
        (select f.created_by_organization_id from facilities f where f.id = facility_id)
  );

comment on table facility_edits is
  'Direct edits, correction suggestions, and shared audit history for canonical
   facility facts. status=applied rows are public history visible to all
   organizations. Never contains organization-private notes.';
