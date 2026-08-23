-- Permanent human-readable Atlas Facility ID: GA-0001, TN-0001, and so on.
--
-- Assigned once on insert and never changed. If a facility's state is later
-- corrected the ID stays put — a permanent identifier that renumbers is not a
-- permanent identifier, and it may already be printed on a schedule or quoted
-- in an email.

create table if not exists facility_code_sequences (
  state_code text primary key,
  last_number integer not null default 0
);

alter table facility_code_sequences enable row level security;
-- No policies: only the SECURITY DEFINER trigger below touches this table.

alter table facilities add column if not exists atlas_id text;

create or replace function public.assign_facility_atlas_id()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  prefix text;
  next_num integer;
begin
  -- Never reassign. Protects the identifier across state corrections and
  -- makes the trigger safe to leave in place on UPDATE.
  if new.atlas_id is not null then
    return new;
  end if;

  -- XX groups facilities with no state yet. They keep that ID even if a state
  -- is added later, by design.
  prefix := upper(coalesce(nullif(trim(new.state), ''), 'XX'));
  if length(prefix) > 2 then
    prefix := substr(prefix, 1, 2);
  end if;

  -- Atomic increment. Concurrent inserts cannot collide on the same number.
  insert into facility_code_sequences (state_code, last_number)
  values (prefix, 1)
  on conflict (state_code)
  do update set last_number = facility_code_sequences.last_number + 1
  returning last_number into next_num;

  new.atlas_id := prefix || '-' || lpad(next_num::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists trg_assign_facility_atlas_id on facilities;
create trigger trg_assign_facility_atlas_id
  before insert on facilities
  for each row execute function public.assign_facility_atlas_id();

comment on column facilities.atlas_id is
  'Permanent human-readable Atlas Facility ID (GA-0001). Assigned on insert,
   never reassigned — including if the state is later corrected. Safe to print
   on schedules and quote externally.';

comment on table facility_code_sequences is
  'Per-state counter behind atlas_id. Written only by assign_facility_atlas_id().
   Numbers are never reused, so a deleted facility does not free its ID.';
