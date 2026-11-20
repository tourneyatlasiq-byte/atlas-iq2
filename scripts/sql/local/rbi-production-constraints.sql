-- The production plate_appearances rules the lineup test schema leaves out.
-- is_qab (generated) already comes from participants-overlay.sql. Definitions copied from pg_constraint / the qab_* views on production, 2026-11-20.
alter table public.plate_appearances
  add column notes text,
  add column updated_at timestamptz not null default now();
alter table public.plate_appearances
  add constraint pa_reasons_allowed check (qab_reasons <@ ARRAY['hit'::text,'walk'::text,'hbp'::text,'hard_hit'::text,'eight_pitch'::text,'situation_success'::text,'sac_bunt'::text,'sac_fly'::text]),
  add constraint pa_one_reason check (cardinality(qab_reasons) <= 1),
  add constraint plate_appearances_notes_length check (notes is null or char_length(notes) <= 280);
create function public.normalize_qab_reasons() returns trigger language plpgsql as $$
begin
  new.qab_reasons := array(select distinct unnest(new.qab_reasons) order by 1);
  new.updated_at := now();
  return new;
end; $$;
create trigger trg_normalize_qab_reasons before insert or update on public.plate_appearances
  for each row execute function public.normalize_qab_reasons();
create view public.qab_reason_tournament as
  select pa.organization_id, pa.season_id, g.tournament_id, r.reason, count(*) as occurrences
  from plate_appearances pa join games g on g.id = pa.game_id
  cross join lateral unnest(pa.qab_reasons) r(reason)
  where pa.voided_at is null and g.tournament_id is not null
  group by pa.organization_id, pa.season_id, g.tournament_id, r.reason;
