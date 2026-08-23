-- Development accounts now resolve to the clean demo organization.
-- Legacy Georgia Power records remain intact in the database, just not surfaced in-app.
-- Reversible: set organization_id back to '00000000-0000-0000-0000-000000000001'.
update profiles
set organization_id = 'a71a5000-0000-0000-0000-000000000001'
where id in (select id from auth.users);
