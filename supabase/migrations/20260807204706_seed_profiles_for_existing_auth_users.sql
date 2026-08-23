-- Link existing auth users to the single existing organization.
-- Creates no new organization and no new team/season/test data.
insert into profiles (id, organization_id, full_name, role)
select u.id,
       (select id from organizations order by id limit 1),
       coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
       'coach'
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);
