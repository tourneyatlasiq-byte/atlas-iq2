-- Locations: three new Surface options.
--
-- Scope, exactly:
--   The facilities.surface_type rule gains three allowed values:
--     'All Turf'      artificial turf throughout
--     'Dirt / Grass'  dirt infield with a grass outfield
--     'Turf / Grass'  turf infield with a grass outfield
--   Every value that is allowed today stays allowed: Grass, Turf, Mixed,
--   Unknown, and NULL.
--
-- No row is touched. The 17 Grass, 16 Turf, 106 Mixed, 41 Unknown and 4 blank
-- locations keep exactly the value they have now. No table, column, policy,
-- trigger or function changes.
--
-- Safe with the code that is running today: widening an allowed list cannot
-- reject anything the current code writes. Apply this BEFORE the application
-- update that offers the new options.
--
-- Rollback (only valid while no row uses a new value):
--   alter table public.facilities drop constraint facilities_surface_type_check;
--   alter table public.facilities add constraint facilities_surface_type_check
--     check (surface_type is null or surface_type = any (array['Grass','Turf','Mixed','Unknown']));

alter table public.facilities
  drop constraint if exists facilities_surface_type_check;

alter table public.facilities
  add constraint facilities_surface_type_check
  check (
    surface_type is null
    or surface_type = any (array[
      'All Turf'::text, 'Dirt / Grass'::text, 'Turf / Grass'::text,
      'Grass'::text, 'Turf'::text, 'Mixed'::text, 'Unknown'::text
    ])
  );

comment on column public.facilities.surface_type is
  'All Turf | Dirt / Grass | Turf / Grass (current choices); Grass | Turf | Mixed | Unknown (older values, still valid and never reclassified automatically). Dirt / Grass = dirt infield, grass outfield. Turf / Grass = turf infield, grass outfield.';
