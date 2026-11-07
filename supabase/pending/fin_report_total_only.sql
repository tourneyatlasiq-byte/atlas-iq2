-- Budget lines: "Parent report: Show total only" (2026-11).
--
-- PENDING. Not applied. Moves to supabase/migrations/ under the version
-- Supabase records once it has been applied through the MCP tool.
--
-- Why. The Detailed parent budget report itemizes expense transactions. Some
-- budget lines hold money that must never be itemized for families — coach
-- stipends and instruction above all. Categories are free text, so no name can
-- be trusted to identify them. This flag is the durable rule: a line with
-- report_total_only = true contributes only its total to Detailed; none of its
-- transactions' dates, descriptions or amounts are printed. Report behaviour is
-- never inferred from a category name.
--
-- What changes.
--   1. budget_items.report_total_only boolean not null default false.
--      Every existing line becomes false: no report changes for anyone.
--   2. ONE audited line is set to true: Northgate 16U Gold's "Coach stipends"
--      (category Coaches), the only Coaches line in production at audit
--      (2026-11-07). Matched on every identifying field.
--
-- Guards (any failure raises and nothing changes):
--   a. the column does not already exist
--   b. exactly one budget line is the audited one, unchanged since the audit
--   c. exactly one row is updated, and afterwards exactly one line is true
--   d. no other column of budget_items changes (row fingerprint)
--   e. no transaction, tournament or dues row is touched (not referenced here)

do $$
declare
  n_updated int;
  n_true int;
  n_match int;
  rows_before text;
  rows_after text;
begin
  -- Guard a
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'budget_items'
                and column_name = 'report_total_only') then
    raise exception 'Aborted: budget_items.report_total_only already exists.';
  end if;

  -- Guard b
  select count(*) into n_match from public.budget_items
   where id = 'a71a5000-0000-0000-0000-000000000908'
     and season_id = 'a71a5000-0000-0000-0000-000000000003'
     and organization_id = 'a71a5000-0000-0000-0000-000000000001'
     and category = 'Coaches' and name = 'Coach stipends'
     and budgeted = 1500.00 and is_income = false;
  if n_match <> 1 then
    raise exception 'Aborted: the audited Coach stipends line no longer matches (found %).', n_match;
  end if;

  select md5(coalesce(string_agg((id, organization_id, season_id, category, name, budgeted,
           is_income, notes, created_at, quantity, unit_cost)::text, '#' order by id), ''))
    into rows_before from public.budget_items;

  alter table public.budget_items
    add column report_total_only boolean not null default false;

  update public.budget_items
     set report_total_only = true
   where id = 'a71a5000-0000-0000-0000-000000000908'
     and category = 'Coaches' and name = 'Coach stipends';
  get diagnostics n_updated = row_count;

  -- Guard c
  select count(*) into n_true from public.budget_items where report_total_only;
  if n_updated <> 1 or n_true <> 1 then
    raise exception 'Aborted: expected 1 line flagged, updated % and % flagged.', n_updated, n_true;
  end if;

  -- Guard d
  select md5(coalesce(string_agg((id, organization_id, season_id, category, name, budgeted,
           is_income, notes, created_at, quantity, unit_cost)::text, '#' order by id), ''))
    into rows_after from public.budget_items;
  if rows_after <> rows_before then
    raise exception 'Aborted: a budget line column other than report_total_only changed.';
  end if;

  raise notice 'report_total_only added; 1 line flagged (Northgate Coach stipends).';
end
$$;

comment on column public.budget_items.report_total_only is
  'Parent report: show total only. When true, this line''s transactions are never itemized on the '
  'Detailed parent budget report; its total is still included. Set by the coach; never inferred from '
  'the category name.';
