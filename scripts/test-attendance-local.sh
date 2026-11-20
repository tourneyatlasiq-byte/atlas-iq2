#!/bin/bash
# Runs the REAL lineup actions (lib/actions/lineup.js) and the tracker cursor
# against a throwaway local Postgres, through the real supabase-js client and
# the local REST shim. Local fixture, fictional data. Never touches Supabase.
# Needs: PGHOST / PGPORT / PGUSER set; "pg" under PG_MODULE_PATH (default /tmp/pgmod/node_modules).
set -e
cd "$(dirname "$0")/.."
DB=${DB:-attendance_local}
PORT=${PGRST_PORT:-3057}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -q -d $DB -v ON_ERROR_STOP=1"
$P -f scripts/sql/local/mark-paid-schema.sql >/dev/null 2>&1
$P -f scripts/sql/local/roster-seed.sql
$P -f scripts/sql/local/lineup-schema.sql
$P -f scripts/sql/local/lineup-seed.sql
$P -f scripts/sql/local/participants-overlay.sql
$P -f supabase/migrations/20261119231508_lineup_in_game_integrity.sql
export JWT_SECRET=local-test-secret-local-test-secret-1234
export DB_URI="postgres://${PGUSER:-postgres}@127.0.0.1:${PGPORT:-5432}/$DB"
export SHIM_PORT=$PORT
export NODE_PATH=${PG_MODULE_PATH:-/tmp/pgmod/node_modules}
node scripts/local-rest-shim.js > /tmp/shim-attendance.log 2>&1 &
PID=$!
trap "kill $PID 2>/dev/null" EXIT
for i in $(seq 1 40); do grep -q "shim ready" /tmp/shim-attendance.log 2>/dev/null && break; sleep 0.25; done
grep -q "shim ready" /tmp/shim-attendance.log || { echo "shim did not start"; cat /tmp/shim-attendance.log; exit 2; }
POSTGREST_URL="http://127.0.0.1:$PORT" DB_NAME=$DB node scripts/test-attendance-local.js
