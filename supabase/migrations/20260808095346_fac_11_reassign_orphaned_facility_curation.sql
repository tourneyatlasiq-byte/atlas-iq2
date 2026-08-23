-- The seven originally-seeded facilities were created under the legacy Georgia
-- Power organization, which now has zero profiles pointing at it. Under the new
-- admin-only edit policy that made them permanently uneditable by anyone —
-- including Hobgood Park, an actively used venue.
--
-- Curation moves to the active organization. This changes only who may edit the
-- shared record; the facilities themselves and all legacy Georgia Power data
-- are otherwise untouched.
update facilities
set created_by_organization_id = 'a71a5000-0000-0000-0000-000000000001'
where created_by_organization_id = '00000000-0000-0000-0000-000000000001';
