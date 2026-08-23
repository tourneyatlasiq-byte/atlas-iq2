with ordered as (
  select id,
         upper(coalesce(nullif(trim(state), ''), 'XX')) as prefix,
         row_number() over (
           partition by upper(coalesce(nullif(trim(state), ''), 'XX'))
           order by name
         ) as seq
  from facilities
  where atlas_id is null
)
update facilities f
set atlas_id = o.prefix || '-' || lpad(o.seq::text, 4, '0')
from ordered o
where f.id = o.id;

insert into facility_code_sequences (state_code, last_number)
select split_part(atlas_id, '-', 1), max(split_part(atlas_id, '-', 2)::int)
from facilities
where atlas_id is not null
group by split_part(atlas_id, '-', 1)
on conflict (state_code) do update
set last_number = greatest(facility_code_sequences.last_number, excluded.last_number);

alter table facilities alter column atlas_id set not null;
alter table facilities drop constraint if exists facilities_atlas_id_unique;
alter table facilities add constraint facilities_atlas_id_unique unique (atlas_id);
create index if not exists idx_facilities_atlas_id on facilities (atlas_id);
