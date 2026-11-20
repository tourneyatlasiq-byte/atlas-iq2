#!/usr/bin/env bash
# Proves supabase/pending/tournament_resources_planned.sql on a throwaway local Postgres. Never touches production.
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-5432} PGUSER=${PGUSER:-postgres}
DB=planned_mig_test
psql -qAt -c "drop database if exists $DB" -c "create database $DB" >/dev/null
trap 'psql -qAt -c "drop database if exists $DB" >/dev/null' EXIT
P="psql -qAt -v ON_ERROR_STOP=1 -d $DB"
$P -c "create table public.tournament_resources (id serial primary key, context text not null default 'used', constraint tournament_resources_context_check check (context in ('used','recommended','considered')));"
$P -c "insert into public.tournament_resources (context) values ('used'),('recommended'),('considered');"
fail=0; ok(){ if [ "$2" = "$3" ]; then echo "  ok    $1"; else echo "  FAIL  $1 (expected $3, got $2)"; fail=1; fi; }
ok "before: planned is refused" "$($P -c "insert into public.tournament_resources (context) values ('planned');" 2>&1 | grep -c 'violates check constraint')" "1"
before=$($P -c "select string_agg(context||':'||n, ',' order by context) from (select context, count(*) n from public.tournament_resources group by 1) s;")
$P -f supabase/pending/tournament_resources_planned.sql >/dev/null
after=$($P -c "select string_agg(context||':'||n, ',' order by context) from (select context, count(*) n from public.tournament_resources group by 1) s;")
ok "existing rows unchanged" "$after" "$before"
ok "planned is accepted" "$($P -c "insert into public.tournament_resources (context) values ('planned') returning context;")" "planned"
ok "a bad value is still refused" "$($P -c "insert into public.tournament_resources (context) values ('bogus');" 2>&1 | grep -c 'violates check constraint')" "1"
ok "all four values allowed" "$($P -c "select pg_get_constraintdef(oid) from pg_constraint where conname='tournament_resources_context_check';" | grep -o "'[a-z]*'" | sort | tr '\n' ' ')" "'considered' 'planned' 'recommended' 'used' "
$P -c "delete from public.tournament_resources where context='planned';"
$P -c "alter table public.tournament_resources drop constraint tournament_resources_context_check; alter table public.tournament_resources add constraint tournament_resources_context_check check (context in ('used','recommended','considered'));"
ok "rollback (with no planned rows) restores the old rule" "$($P -c "insert into public.tournament_resources (context) values ('planned');" 2>&1 | grep -c 'violates check constraint')" "1"
[ $fail = 0 ] && echo "planned migration: all checks passed" || { echo "planned migration: FAILED"; exit 1; }
