create policy "TEMP demo read - remove after auth is added" on payments
  for select using (team_id = '00000000-0000-0000-0000-000000000001');

create policy "TEMP demo read - remove after auth is added" on payment_log
  for select using (
    payment_id in (select id from payments where team_id = '00000000-0000-0000-0000-000000000001')
  );
