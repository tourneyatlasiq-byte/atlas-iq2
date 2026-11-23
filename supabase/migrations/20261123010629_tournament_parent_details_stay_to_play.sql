-- Tournament Parent Details and the Stay-to-Play travel type.
--
-- Scope, exactly:
--   1. one optional text column, public.tournaments.parent_details
--   2. the existing travel_type rule gains one allowed value, 'Stay-to-Play'
-- No new tables. No policy, trigger or function changes. No existing row is
-- touched: the new column starts empty (NULL) for every tournament, and every
-- existing travel_type value remains allowed.
--
-- The column inherits the tournaments table's existing row-level security, so a
-- tournament's Parent Details are readable and writable by exactly the people
-- who can already read and write that tournament.

alter table public.tournaments
  add column if not exists parent_details text;

comment on column public.tournaments.parent_details is
  'Optional, parent-facing logistics (lodging, deadlines, links). Printed only on the Tournament Schedule report when the coach chooses to include it. Separate from the internal notes column, which is never printed.';

alter table public.tournaments
  drop constraint if exists tournaments_travel_type_check;

alter table public.tournaments
  add constraint tournaments_travel_type_check
  check (
    travel_type is null
    or travel_type = any (array['Day Trip'::text, 'Overnight'::text, 'Extended Stay'::text, 'Stay-to-Play'::text])
  );
