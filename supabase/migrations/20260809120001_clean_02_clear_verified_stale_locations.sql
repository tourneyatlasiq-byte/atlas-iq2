-- Clears the free-text fallback ONLY where a canonical facility already
-- supplies the location, so nothing is lost.
--
-- The four rows with no facility_id keep their location: it is currently the
-- only record of where those events are held. They are logged as a data-quality
-- task and must be linked to a facility before their fallback is cleared.

update tournaments t
   set location = null
  from facilities f
 where f.id = t.facility_id
   and t.location is not null
   and f.city is not null
   and f.state is not null;
