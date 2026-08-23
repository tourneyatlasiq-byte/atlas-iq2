-- Every demo player currently has an identical 2 x $200 paid against $2,400,
-- which makes every balance the same. Vary it so Finance is testable:
-- some paid in full, some partial, some nothing.
with ranked as (
  select pp.id, row_number() over (order by p.full_name) as rn
  from player_payments pp
  join players p on p.id = pp.player_id
  where pp.season_id = 'a71a5000-0000-0000-0000-000000000003'
)
delete from payment_log
where payment_id in (select id from ranked where rn > 8);

-- Two players fully paid.
with ranked as (
  select pp.id, row_number() over (order by p.full_name) as rn
  from player_payments pp
  join players p on p.id = pp.player_id
  where pp.season_id = 'a71a5000-0000-0000-0000-000000000003'
)
insert into payment_log (payment_id, month_label, amount, paid_date)
select r.id, m.label, 500, m.pd
from ranked r
cross join (values
  ('Oct 2026','2026-10-05'::date),
  ('Nov 2026','2026-11-05'::date),
  ('Dec 2026','2026-12-05'::date),
  ('Jan 2027','2027-01-05'::date)
) as m(label, pd)
where r.rn <= 2;

-- Four more make partial progress.
with ranked as (
  select pp.id, row_number() over (order by p.full_name) as rn
  from player_payments pp
  join players p on p.id = pp.player_id
  where pp.season_id = 'a71a5000-0000-0000-0000-000000000003'
)
insert into payment_log (payment_id, month_label, amount, paid_date)
select r.id, 'Oct 2026', 300, '2026-10-05'::date
from ranked r
where r.rn between 3 and 6;
