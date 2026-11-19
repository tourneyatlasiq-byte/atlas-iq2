#!/bin/bash
# Simultaneous saves from separate database sessions (separate "screens"),
# against the local fixture only. Each session holds its transaction open for
# a moment after calling the function, so the sessions genuinely overlap.
# Needs a local Postgres 16 server; set PGHOST / PGPORT / PGUSER as needed.
cd "$(dirname "$0")/.."
DB=${DB:-markpaid_conc}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" || exit 1
P="psql -q -d $DB -v ON_ERROR_STOP=1"
$P -f scripts/sql/local/mark-paid-schema.sql >/dev/null 2>&1
$P -f ${MIGRATION:-supabase/migrations/20261119172925_mark_tournament_paid_in_full.sql} || exit 1
OWNER=10000000-0000-0000-0000-000000000001
COACH=10000000-0000-0000-0000-000000000002
OUTSIDER=10000000-0000-0000-0000-000000000009
ORGB=b0000000-0000-0000-0000-000000000001
ORG=a0000000-0000-0000-0000-000000000001
SEASON=5a000000-0000-0000-0000-000000000001
LINE=e0000000-0000-0000-0000-000000000001
$P <<SQL
insert into organizations (id,name) values ('$ORG','Org A');
insert into seasons (id,team_id,name,phase) values ('$SEASON','$ORG','current','current');
insert into organizations (id,name) values ('$ORGB','Org B');
insert into test_memberships values ('$OWNER','$ORG','owner'),('$COACH','$ORG','coach'),('$OUTSIDER','$ORGB','owner');
insert into budget_items (id,organization_id,season_id,category,name) values ('$LINE','$ORG','$SEASON','Tournaments','Fees');
SQL
FAILS=0; PASSES=0
ok() { if [ "$2" = "1" ]; then PASSES=$((PASSES+1)); echo "  ok    $1"; else FAILS=$((FAILS+1)); echo "  FAIL  $1"; fi; }
q() { psql -At -d $DB -c "$1"; }
# run one statement as the signed-in owner (the writers now check who is calling)
qo() { psql -qAt -d $DB <<SQL | tail -1
begin; set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','$OWNER','role','authenticated')::text, true);
$1;
commit;
SQL
}

# run N sessions at once. $1 = N, $2 = sql template with {i} (index), {u} (user), {k} (fresh uuid)
fan() {
  local n=$1 tpl=$2 out=$3; : > "$out"
  for i in $(seq 1 $n); do
    local u=$OWNER; [ $((i % 2)) -eq 0 ] && u=$COACH   # alternate two different users
    local k; k=$(cat /proc/sys/kernel/random/uuid)
    local body=${tpl//\{i\}/$i}; body=${body//\{u\}/$u}; body=${body//\{k\}/$k}
    ( psql -At -d $DB -v ON_ERROR_STOP=0 <<SQL >> "$out" 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','$u','role','authenticated')::text, true);
select 'R|' || (${body});
select pg_sleep(0.7);
commit;
SQL
    ) &
  done
  wait
}
count() { grep -c "$2" "$1"; }

echo; echo "Player payments: 6 screens, different retry keys, all showing paid = 0"
$P -c "insert into player_payments (id,organization_id,season_id,player_name,initial_cost) values ('f0000000-0000-0000-0000-0000000000a1','$ORG','$SEASON','Conc One',1000)"
fan 6 "public.record_player_payment('f0000000-0000-0000-0000-0000000000a1','{k}',0,100,null,null)::text" /tmp/c1.out
ok "exactly one of six saved" $([ "$(count /tmp/c1.out '"ok": true')" = "1" ] && echo 1 || echo 0)
ok "the other five were refused as changed" $([ "$(count /tmp/c1.out '"code": "changed"')" = "5" ] && echo 1 || echo 0)
ok "one payment row in the database" $([ "$(q "select count(*) from payment_log where payment_id='f0000000-0000-0000-0000-0000000000a1'")" = "1" ] && echo 1 || echo 0)

echo; echo "Player payments: 6 screens, different keys, no balance shown (recheck skipped)"
$P -c "insert into player_payments (id,organization_id,season_id,player_name,initial_cost) values ('f0000000-0000-0000-0000-0000000000a2','$ORG','$SEASON','Conc Two',1000)"
fan 6 "public.record_player_payment('f0000000-0000-0000-0000-0000000000a2','{k}',null,100,null,null)::text" /tmp/c2.out
ok "all six saved, none lost" $([ "$(q "select count(*) from payment_log where payment_id='f0000000-0000-0000-0000-0000000000a2'")" = "6" ] && echo 1 || echo 0)
ok "total is exactly 600" $([ "$(q "select sum(amount) from payment_log where payment_id='f0000000-0000-0000-0000-0000000000a2'")" = "600.00" ] || [ "$(q "select sum(amount) from payment_log where payment_id='f0000000-0000-0000-0000-0000000000a2'")" = "600" ] && echo 1 || echo 0)

echo; echo "Player payments: the same retry key sent from 6 screens at once"
$P -c "insert into player_payments (id,organization_id,season_id,player_name,initial_cost) values ('f0000000-0000-0000-0000-0000000000a3','$ORG','$SEASON','Conc Three',1000)"
KEY=$(cat /proc/sys/kernel/random/uuid)
: > /tmp/c3.out
for i in 1 2 3 4 5 6; do
 ( psql -At -d $DB <<SQL >> /tmp/c3.out 2>&1
begin; set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','$OWNER','role','authenticated')::text, true);
select 'R|' || (public.record_player_payment('f0000000-0000-0000-0000-0000000000a3','$KEY',0,100,null,null))::text;
select pg_sleep(0.5); commit;
SQL
 ) & done; wait
ok "one row recorded" $([ "$(q "select count(*) from payment_log where payment_id='f0000000-0000-0000-0000-0000000000a3'")" = "1" ] && echo 1 || echo 0)
ok "five reported as duplicates of the first" $([ "$(count /tmp/c3.out '"duplicate": true')" = "5" ] && echo 1 || echo 0)

echo; echo "Mark paid in full: 5 screens, different keys, same dialog figures"
$P -c "insert into tournaments (id,organization_id,season_id,name,entry_fee,decision,paid_status,budget_item_id) values ('c0000000-0000-0000-0000-0000000000b1','$ORG','$SEASON','Conc Tourney',500,'Committed','Registered','$LINE')"
fan 5 "public.mark_tournament_paid_in_full('c0000000-0000-0000-0000-0000000000b1','{k}','Registered',0,0,true,null,null,null,null,(select total_cost from tournaments where id='c0000000-0000-0000-0000-0000000000b1'),'[]'::jsonb)::text" /tmp/c4.out
ok "exactly one save succeeded" $([ "$(count /tmp/c4.out '"ok": true')" = "1" ] && echo 1 || echo 0)
ok "the others were refused (already paid)" $([ "$(count /tmp/c4.out '"code": "already_paid"')" = "4" ] && echo 1 || echo 0)
ok "exactly one \$500 payment recorded" $([ "$(q "select count(*)||':'||coalesce(sum(actual_amount),0) from budget_transactions where tournament_id='c0000000-0000-0000-0000-0000000000b1'")" = "1:500.00" ] && echo 1 || echo 0)

echo; echo "Mark paid in full: the same retry key from 5 screens at once"
$P -c "insert into tournaments (id,organization_id,season_id,name,entry_fee,decision,paid_status,budget_item_id) values ('c0000000-0000-0000-0000-0000000000b2','$ORG','$SEASON','Conc Tourney 2',300,'Committed','Registered','$LINE')"
KEY=$(cat /proc/sys/kernel/random/uuid); : > /tmp/c5.out
for i in 1 2 3 4 5; do
 ( psql -At -d $DB <<SQL >> /tmp/c5.out 2>&1
begin; set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','$OWNER','role','authenticated')::text, true);
select 'R|' || (public.mark_tournament_paid_in_full('c0000000-0000-0000-0000-0000000000b2','$KEY','Registered',0,0,true,null,null,null,null,(select total_cost from tournaments where id='c0000000-0000-0000-0000-0000000000b2'),'[]'::jsonb))::text;
select pg_sleep(0.5); commit;
SQL
 ) & done; wait
ok "one payment recorded" $([ "$(q "select count(*) from budget_transactions where tournament_id='c0000000-0000-0000-0000-0000000000b2'")" = "1" ] && echo 1 || echo 0)
ok "four reported as duplicates" $([ "$(count /tmp/c5.out '"duplicate": true')" = "4" ] && echo 1 || echo 0)

echo; echo "Repeated Undo: the same Undo sent from 6 screens at once"
$P -c "insert into player_payments (id,organization_id,season_id,player_name,initial_cost) values ('f0000000-0000-0000-0000-0000000000a4','$ORG','$SEASON','Conc Four',1000)"
OP=$(qo "select (public.record_player_payment('f0000000-0000-0000-0000-0000000000a4','$(cat /proc/sys/kernel/random/uuid)',0,100,null,null))->>'operation_id'")
fan 6 "public.undo_player_payment('$OP')::text" /tmp/c6.out
ok "exactly one Undo succeeded" $([ "$(count /tmp/c6.out '"ok": true')" = "1" ] && echo 1 || echo 0)
ok "the other five were told it was already undone" $([ "$(count /tmp/c6.out '"code": "already_undone"')" = "5" ] && echo 1 || echo 0)
ok "the payment is gone and nothing else was removed" $([ "$(q "select count(*) from payment_log where payment_id='f0000000-0000-0000-0000-0000000000a4'")" = "0" ] && echo 1 || echo 0)

echo; echo "Undo racing a new payment for the same player (10 rounds, both orders)"
RACE_BAD=0
for round in $(seq 1 10); do
  PID=f0000000-0000-0000-0000-0000000001$(printf '%02d' $round)
  $P -c "insert into player_payments (id,organization_id,season_id,player_name,initial_cost) values ('$PID','$ORG','$SEASON','Race $round',1000)"
  OP=$(qo "select (public.record_player_payment('$PID','$(cat /proc/sys/kernel/random/uuid)',0,100,null,null))->>'operation_id'")
  : > /tmp/c7.out
  U1="select 'UNDO|' || (public.undo_player_payment('$OP'))::text;"
  N1="select 'NEW|' || (public.record_player_payment('$PID','$(cat /proc/sys/kernel/random/uuid)',null,40,null,null))::text;"
  if [ $((round % 2)) -eq 0 ]; then A="$U1"; B="$N1"; else A="$N1"; B="$U1"; fi
  ( psql -At -d $DB <<SQL >> /tmp/c7.out 2>&1
begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','$OWNER','role','authenticated')::text, true);
$A
commit;
SQL
  ) &
  ( psql -At -d $DB <<SQL >> /tmp/c7.out 2>&1
begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','$COACH','role','authenticated')::text, true);
$B
commit;
SQL
  ) &
  wait
  UNDO_OK=$(grep -c 'UNDO|.*"ok": true' /tmp/c7.out); NEW_OK=$(grep -c 'NEW|.*"ok": true' /tmp/c7.out)
  ROWS=$(q "select string_agg(amount::text, ',' order by amount) from payment_log where payment_id='$PID'")
  if [ "$NEW_OK" = "1" ] && { { [ "$UNDO_OK" = "1" ] && [ "$ROWS" = "40.00" ]; } || { [ "$UNDO_OK" = "0" ] && [ "$ROWS" = "40.00,100.00" ]; }; }; then :; else RACE_BAD=$((RACE_BAD+1)); echo "    round $round unexpected: undo_ok=$UNDO_OK new_ok=$NEW_OK rows=$ROWS"; fi
done
ok "every round ended consistent (later payment never lost, Undo never applied after it)" $([ $RACE_BAD -eq 0 ] && echo 1 || echo 0)

echo; echo "Undo racing a change to what the player owes"
$P -c "insert into player_payments (id,organization_id,season_id,player_name,initial_cost) values ('f0000000-0000-0000-0000-0000000000a5','$ORG','$SEASON','Conc Five',1000)"
OP=$(qo "select (public.record_player_payment('f0000000-0000-0000-0000-0000000000a5','$(cat /proc/sys/kernel/random/uuid)',0,100,null,null))->>'operation_id'")
: > /tmp/c8.out
( psql -At -d $DB <<SQL >> /tmp/c8.out 2>&1
begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','$OWNER','role','authenticated')::text, true);
update player_payments set initial_cost = 1500 where id='f0000000-0000-0000-0000-0000000000a5';
select pg_sleep(0.7); commit;
SQL
) &
sleep 0.25
( psql -At -d $DB <<SQL >> /tmp/c8.out 2>&1
begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','$COACH','role','authenticated')::text, true);
select 'UNDO|' || (public.undo_player_payment('$OP'))::text;
commit;
SQL
) &
wait
ok "Undo waited for the dues change and was then refused" $([ "$(grep -c 'UNDO|.*changed_since' /tmp/c8.out)" = "1" ] && [ "$(q "select count(*) from payment_log where payment_id='f0000000-0000-0000-0000-0000000000a5'")" = "1" ] && echo 1 || echo 0)

echo; echo "Undo arriving while a new payment is still being saved (deterministic: the new payment holds its transaction open)"
$P -c "insert into player_payments (id,organization_id,season_id,player_name,initial_cost) values ('f0000000-0000-0000-0000-0000000000a6','$ORG','$SEASON','Conc Six',1000)"
OP=$(qo "select (public.record_player_payment('f0000000-0000-0000-0000-0000000000a6','$(cat /proc/sys/kernel/random/uuid)',0,100,null,null))->>'operation_id'")
: > /tmp/c9.out
( psql -At -d $DB <<SQL >> /tmp/c9.out 2>&1
begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','$OWNER','role','authenticated')::text, true);
select 'NEW|' || (public.record_player_payment('f0000000-0000-0000-0000-0000000000a6','$(cat /proc/sys/kernel/random/uuid)',100,40,null,null))::text;
select pg_sleep(0.7); commit;
SQL
) &
sleep 0.25
( psql -At -d $DB <<SQL >> /tmp/c9.out 2>&1
begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','$COACH','role','authenticated')::text, true);
select 'UNDO|' || (public.undo_player_payment('$OP'))::text;
commit;
SQL
) &
wait
ok "the new payment was saved" $([ "$(grep -c 'NEW|.*"ok": true' /tmp/c9.out)" = "1" ] && echo 1 || echo 0)
ok "Undo waited for it and was then refused (changed_since)" $([ "$(grep -c 'UNDO|.*changed_since' /tmp/c9.out)" = "1" ] && echo 1 || echo 0)
ok "both payments are still there (the later one is never lost)" $([ "$(q "select string_agg(amount::text, ',' order by amount) from payment_log where payment_id='f0000000-0000-0000-0000-0000000000a6'")" = "40.00,100.00" ] && echo 1 || echo 0)

echo; echo "A caller outside the organization is refused at once, even while the row is locked"
$P -c "insert into tournaments (id,organization_id,season_id,name,entry_fee,decision,paid_status,budget_item_id) values ('c0000000-0000-0000-0000-0000000000b9','$ORG','$SEASON','Lock probe',500,'Committed','Registered','$LINE')"
( psql -qAt -d $DB -c "begin; select 1 from tournaments where id='c0000000-0000-0000-0000-0000000000b9' for update; select pg_sleep(2.5); commit;" >/dev/null 2>&1 ) &
sleep 0.5
T0=$(date +%s%N)
RES=$(psql -qAt -d $DB <<SQL | grep '^R|'
begin; set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','$OUTSIDER','role','authenticated')::text, true);
select 'R|' || (public.mark_tournament_paid_in_full('c0000000-0000-0000-0000-0000000000b9', gen_random_uuid(), 'Registered', 0, 0, true, null, null, null, null, 500, '[]'::jsonb))::text;
commit;
SQL
)
MS=$(( ($(date +%s%N) - T0) / 1000000 ))
wait
ok "outsider told not found" $(echo "$RES" | grep -q '"code": "not_found"' && echo 1 || echo 0)
ok "...without waiting for the lock (took ${MS} ms, lock held 2000+ ms)" $([ "$MS" -lt 1000 ] && echo 1 || echo 0)

echo; echo "$PASSES passed, $FAILS failed"
[ $FAILS -eq 0 ] && echo "CONCURRENCY TESTS PASSED" || { echo "CONCURRENCY TESTS FAILED"; exit 1; }
