-- Tournament IQ vocabulary correction.
-- decision:    Yes/Maybe/No described an answer, not a state.
-- travel_type: Local/Regional mixed distance with duration. Now one axis: lodging.
-- paid_status: was unconstrained free text and had already drifted
--              ("Paid" and "Paid in Full" both present).

alter table tournaments drop constraint if exists tournaments_decision_check;
alter table tournaments drop constraint if exists tournaments_travel_type_check;

update tournaments set decision = case decision
  when 'Yes'   then 'Committed'
  when 'Maybe' then 'Considering'
  when 'No'    then 'Declined'
  else decision end;

update tournaments set travel_type = case travel_type
  when 'Local'     then 'Day Trip'
  when 'Regional'  then 'Overnight'   -- regional events in this dataset were single-night
  when 'Overnight' then 'Overnight'
  else travel_type end;

update tournaments set paid_status = case paid_status
  when 'Unpaid'        then 'Not Registered'
  when 'Deposit'       then 'Deposit Paid'
  when 'Paid'          then 'Paid in Full'
  when 'Paid in Full'  then 'Paid in Full'
  else 'Not Registered' end;

alter table tournaments
  add constraint tournaments_decision_check
  check (decision = any (array['Considering','Committed','Declined']));

alter table tournaments
  add constraint tournaments_travel_type_check
  check (travel_type is null or travel_type = any (array['Day Trip','Overnight','Extended Stay']));

alter table tournaments
  add constraint tournaments_paid_status_check
  check (paid_status = any (array['Not Registered','Registered','Deposit Paid','Paid in Full']));

alter table tournaments alter column decision set default 'Considering';
alter table tournaments alter column paid_status set default 'Not Registered';

alter table tournaments add column if not exists event_url text;

comment on column tournaments.event_url is 'Official event or registration page. Distinct from tournament_providers.website_url, which is the provider''s own site.';
comment on column tournaments.decision is 'Considering | Committed | Declined. Declined also serves as the archive state; there is no separate archived_at.';
comment on column tournaments.travel_type is 'Lodging requirement, not distance: Day Trip | Overnight | Extended Stay.';
