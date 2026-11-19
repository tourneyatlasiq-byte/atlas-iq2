#!/bin/bash
# Runs the REAL server actions (lib/actions/*.js) through the REAL
# @supabase/supabase-js client against a throwaway local Postgres. Path:
# action -> supabase-js -> scripts/local-rest-shim.js (a small stand-in for
# PostgREST) -> row security, triggers and the migration's functions, all real.
# Never touches Supabase.
#
# Needs: local Postgres 16 (PGHOST / PGPORT / PGUSER set) and the "pg" node
# package outside the repo (PG_MODULE_PATH, default /tmp/pgmod/node_modules).
set -e
cd "$(dirname "$0")/.."
DB=${DB:-markpaid_actions}
PORT=${PGRST_PORT:-3055}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -q -d $DB -v ON_ERROR_STOP=1"
$P -f scripts/sql/local/mark-paid-schema.sql >/dev/null 2>&1
$P -f ${MIGRATION:-supabase/migrations/20261119172925_mark_tournament_paid_in_full.sql}
$P -f scripts/sql/local/actions-seed.sql
$P -f scripts/sql/local/roster-seed.sql
export JWT_SECRET=local-test-secret-local-test-secret-1234
export DB_URI="postgres://${PGUSER:-postgres}@127.0.0.1:${PGPORT:-5432}/$DB"
export SHIM_PORT=$PORT
# "pg" is a test-only dependency, kept out of the repo's package.json:  (cd /tmp/pgmod && npm i pg)
export NODE_PATH=${PG_MODULE_PATH:-/tmp/pgmod/node_modules}
node scripts/local-rest-shim.js > /tmp/shim.log 2>&1 &
PID=$!
trap "kill $PID 2>/dev/null" EXIT
for i in $(seq 1 40); do grep -q "shim ready" /tmp/shim.log 2>/dev/null && break; sleep 0.25; done
grep -q "shim ready" /tmp/shim.log || { echo "shim did not start"; cat /tmp/shim.log; exit 2; }
POSTGREST_URL="http://127.0.0.1:$PORT" DB_NAME=$DB node scripts/test-actions-local.js
