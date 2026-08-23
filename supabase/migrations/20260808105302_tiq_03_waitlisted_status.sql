-- Waitlisted sits between Registered and Not Registered: registration action
-- has been taken, but the spot is not held. It is deliberately NOT ordered
-- after Registered, because a waitlist may never convert.
alter table tournaments drop constraint if exists tournaments_paid_status_check;
alter table tournaments add constraint tournaments_paid_status_check
  check (paid_status = any (array[
    'Not Registered','Waitlisted','Registered','Deposit Paid','Paid in Full'
  ]));

comment on column tournaments.paid_status is
  'Not Registered | Waitlisted | Registered | Deposit Paid | Paid in Full.
   Waitlisted means registration was submitted but no place is held, so it is
   excluded from registration and payment reminders and has its own
   "waitlist unresolved" rule instead.';
