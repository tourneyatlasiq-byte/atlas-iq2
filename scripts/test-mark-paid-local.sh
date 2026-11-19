#!/bin/bash
# Rebuilds a throwaway local Postgres database from the fixture, applies the
# pending migration, and runs the tests. Never touches Supabase.
# Needs a local Postgres 16 server; set PGHOST / PGPORT / PGUSER as needed.
set -e
cd "$(dirname "$0")/.."
DB=${DB:-markpaid_test}
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -f scripts/sql/local/mark-paid-schema.sql 2>&1 | grep -v NOTICE || true
$P -f ${MIGRATION:-supabase/migrations/20261119172925_mark_tournament_paid_in_full.sql}
$P -f scripts/sql/local/mark-paid-tests.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //' | grep -v '^$' | tee /tmp/markpaid-test.out
if grep -q '^FAIL' /tmp/markpaid-test.out || grep -q ERROR /tmp/markpaid-test.out; then echo "TESTS FAILED"; exit 1; fi
echo "TESTS PASSED"
