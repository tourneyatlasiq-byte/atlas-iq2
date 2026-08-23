insert into organizations (team_id, name)
select t.id, org_name
from teams t
cross join (values
  ('PGF'), ('USA Softball'), ('Alliance Fastpitch'), ('Top Flight'),
  ('USSSA'), ('Triple Crown'), ('Tournament Connect'), ('TravelSports')
) as orgs(org_name)
where not exists (
  select 1 from organizations o where o.team_id = t.id and o.name = orgs.org_name
);
