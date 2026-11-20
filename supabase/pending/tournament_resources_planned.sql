-- PENDING. NOT APPLIED. For separate review (RES-001).
--
-- Adds one value, 'planned', to tournament_resources.context.
--
-- Why: the link picker offers "Used / Recommended / Considered". A coach linking a
-- hotel for a tournament that has not happened yet means "we plan to use it".
-- That is not the same thing as "used", so it must not be stored as 'used'.
-- Nothing is reinterpreted: existing rows keep exactly the meaning they have.
--
-- Shape of the change: additive only. The check constraint is replaced by a
-- wider one. No column, no row and no policy changes. RLS is untouched.
--
-- Wording the app will use (a separate, later code change; not part of this file):
--   planned      "Planned for this trip"   default for tournaments that have not started
--   recommended  "Recommended"
--   considered   "Considering"
--   used         "Used"                    offered only once the tournament has started or passed
--
-- Apply (when approved), in one step:

begin;

alter table public.tournament_resources
  drop constraint tournament_resources_context_check;

alter table public.tournament_resources
  add constraint tournament_resources_context_check
  check (context in ('used', 'recommended', 'considered', 'planned'));

commit;

-- Verify after applying:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'tournament_resources_context_check';
--   -- expect: CHECK ((context = ANY (ARRAY['used', 'recommended', 'considered', 'planned'])))
--   select context, count(*) from public.tournament_resources group by 1;
--   -- expect: counts unchanged from before the change; no 'planned' rows yet.
--
-- Rollback (safe only while no row uses 'planned'; check first):
--   select count(*) from public.tournament_resources where context = 'planned';   -- must be 0
--   begin;
--   alter table public.tournament_resources drop constraint tournament_resources_context_check;
--   alter table public.tournament_resources
--     add constraint tournament_resources_context_check
--     check (context in ('used', 'recommended', 'considered'));
--   commit;
-- If 'planned' rows exist, decide with the owner what they become BEFORE rolling back;
-- do not silently convert them to 'used'.
