-- Files: the database category "Insurance" becomes "Team Insurance".
--
-- Why. On 2026-08-09 the product renamed the Insurance category to "Team
-- Insurance" (lib/documents.js, commit 9bfcf26) and stopped offering Birth
-- Certificate, but documents_category_check was never updated. Every upload or
-- edit that chose "Team Insurance" failed with "new row violates check
-- constraint". First reported 2026-11-07 (three attempts, 13:05–13:08 UTC).
--
-- What changes. Exactly one permitted value: 'Insurance' is replaced by
-- 'Team Insurance'. Every other permitted value is kept, including
-- 'Birth Certificate', which the RLS and storage policies still name as the
-- restricted category. The constraint is no looser than before.
--
-- Guards (any failure raises and nothing changes):
--   1. no document row uses 'Insurance' (it would violate the new constraint)
--   2. the constraint before matches the reviewed definition exactly
--   3. the constraint after matches the approved definition exactly
--   4. no document row is modified (count and fingerprint unchanged)
--
-- Touches only the documents_category_check constraint. No row, policy,
-- trigger or storage object is changed.

do $$
declare
  n_insurance int;
  def_before text;
  def_after text;
  rows_before text;
  rows_after text;
  expected_before constant text :=
    'CHECK ((category = ANY (ARRAY[''Birth Certificate''::text, ''Insurance''::text, ''Sanctioning / Roster''::text, ''Waiver''::text, ''Receipt''::text, ''Team Form''::text, ''Tournament Document''::text, ''Other''::text])))';
  expected_after constant text :=
    'CHECK ((category = ANY (ARRAY[''Birth Certificate''::text, ''Team Insurance''::text, ''Sanctioning / Roster''::text, ''Waiver''::text, ''Receipt''::text, ''Team Form''::text, ''Tournament Document''::text, ''Other''::text])))';
begin
  -- Guard 1
  select count(*) into n_insurance from public.documents where category = 'Insurance';
  if n_insurance > 0 then
    raise exception 'Aborted: % document(s) still use the category Insurance; decide them first.', n_insurance;
  end if;

  -- Guard 2
  select pg_get_constraintdef(oid) into def_before from pg_constraint
   where conrelid = 'public.documents'::regclass and conname = 'documents_category_check';
  if def_before is distinct from expected_before then
    raise exception 'Aborted: documents_category_check is not the reviewed definition: %', def_before;
  end if;

  select md5(coalesce(string_agg(d::text, '#' order by d.id), '')) into rows_before from public.documents d;

  alter table public.documents drop constraint documents_category_check;
  alter table public.documents add constraint documents_category_check
    check (category = any (array[
      'Birth Certificate', 'Team Insurance', 'Sanctioning / Roster', 'Waiver',
      'Receipt', 'Team Form', 'Tournament Document', 'Other'
    ]));

  -- Guard 3
  select pg_get_constraintdef(oid) into def_after from pg_constraint
   where conrelid = 'public.documents'::regclass and conname = 'documents_category_check';
  if def_after is distinct from expected_after then
    raise exception 'Aborted: new documents_category_check is not the approved definition: %', def_after;
  end if;

  -- Guard 4
  select md5(coalesce(string_agg(d::text, '#' order by d.id), '')) into rows_after from public.documents d;
  if rows_after is distinct from rows_before then
    raise exception 'Aborted: a document row changed.';
  end if;

  raise notice 'documents_category_check: Insurance replaced by Team Insurance; % row(s) untouched.',
    (select count(*) from public.documents);
end
$$;
