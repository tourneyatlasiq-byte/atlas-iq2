-- Deletion guard.
--
-- SECURITY DEFINER is the point: an RLS-scoped check only ever sees the
-- current user's own rows, so an organization could try to delete a facility
-- another organization has five tournaments at and see a count of zero.
--
-- Enforced by trigger rather than application code, so it holds regardless of
-- how the delete arrives.

create or replace function public.facility_reference_counts(fid uuid)
returns table (tournaments integer, other_org_notes integer, transactions integer)
language sql stable security definer set search_path to 'public' as $$
  select
    (select count(*)::int from tournaments where facility_id = fid),
    (select count(*)::int from organization_facilities o
       join facilities f on f.id = o.facility_id
      where o.facility_id = fid
        and o.organization_id is distinct from f.created_by_organization_id),
    (select count(*)::int from budget_transactions where facility_id = fid);
$$;

comment on function public.facility_reference_counts(uuid) is
  'Counts references to a facility ACROSS ALL ORGANIZATIONS, for a friendly
   pre-delete message. Returns counts only and never identifies which
   organizations — a deliberate, minimal disclosure that a venue is in use.';

grant execute on function public.facility_reference_counts(uuid) to authenticated;

create or replace function public.prevent_referenced_facility_delete()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  t_count int; n_count int; x_count int; parts text[];
begin
  select count(*) into t_count from tournaments where facility_id = old.id;
  select count(*) into x_count from budget_transactions where facility_id = old.id;

  -- Another organization's private notes must never be cascade-deleted. The
  -- creating organization's own notes may go with the facility, so deleting a
  -- record you created by mistake doesn't require clearing your notes first.
  select count(*) into n_count from organization_facilities
   where facility_id = old.id
     and organization_id is distinct from old.created_by_organization_id;

  parts := array[]::text[];
  if t_count > 0 then parts := parts || (t_count || ' tournament(s)'); end if;
  if n_count > 0 then parts := parts || (n_count || ' other organization(s) with notes'); end if;
  if x_count > 0 then parts := parts || (x_count || ' financial transaction(s)'); end if;

  if array_length(parts, 1) > 0 then
    raise exception
      'Facility % is referenced by %. Shared facilities cannot be deleted once in use.',
      coalesce(old.atlas_id, old.id::text), array_to_string(parts, ', ')
      using errcode = 'restrict_violation';
  end if;

  return old;
end $$;

drop trigger if exists trg_prevent_referenced_facility_delete on facilities;
create trigger trg_prevent_referenced_facility_delete
  before delete on facilities
  for each row execute function public.prevent_referenced_facility_delete();
