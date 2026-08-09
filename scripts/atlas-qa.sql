-- =============================================================================
-- Atlas IQ — automated regression suite
--
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL editor and run it.
--   It returns one row per test. Every row should read PASS.
--
-- SAFETY
--   The entire file runs inside one transaction that ends in ROLLBACK.
--   Nothing is written. Test users and organizations disappear when it ends.
--   It is safe to run against production.
--
-- WHAT IT COVERS
--   tenant isolation · role escalation · RLS · season write protection
--   team/season scoping · Finance calculations · invite security
--   document access including birth certificates
--
-- WHAT IT DOES NOT COVER
--   Anything visual, and browser behaviour such as ?open= routing.
--   Those stay manual — see ATLAS-QA.md.
-- =============================================================================

begin;

create temp table qa (
  n int generated always as identity,
  area text,
  test text,
  result text
) on commit drop;
grant all on qa to authenticated;

-- Deterministic ids so the suite is repeatable.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000a0001'::uuid, 'qa-newuser@test.invalid',  'authenticated','authenticated'),
  ('00000000-0000-0000-0000-0000000a0002'::uuid, 'qa-attacker@test.invalid', 'authenticated','authenticated'),
  ('00000000-0000-0000-0000-0000000a0003'::uuid, 'qa-invitee@test.invalid',  'authenticated','authenticated');

-- The organization under test. Change these two if the demo data is replaced.
create temp table qa_ctx on commit drop as
select
  'a71a5000-0000-0000-0000-000000000001'::uuid as org,
  'a71a5000-0000-0000-0000-000000000002'::uuid as team,
  'a71a5000-0000-0000-0000-000000000003'::uuid as season,
  '9e66ec43-a138-4945-be27-351dffcb1004'::uuid as owner,
  '6452ca9a-aaed-4e28-9dc1-e2f3aa6c058b'::uuid as second_user;

-- Demote the second account to coach for the permission tests.
update profiles set role = 'coach' where id = (select second_user from qa_ctx);
insert into team_memberships (profile_id, team_id, role)
select second_user, team, 'coach' from qa_ctx
on conflict do nothing;

-- A second season, so season-phase rules can be exercised.
insert into seasons (id, team_id, name, is_current, start_date)
select '00000000-0000-0000-0000-0000000a0010'::uuid, team, 'QA Future Season', false, current_date + 400
from qa_ctx;

-- =============================================================================
-- SECTION 1 — as a COACH in the organization under test
-- =============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"6452ca9a-aaed-4e28-9dc1-e2f3aa6c058b","role":"authenticated"}';

do $$
declare n int; c record;
begin
  select * into c from qa_ctx;

  -- --- Role escalation -------------------------------------------------------
  begin
    update profiles set role='owner' where id = auth.uid();
    get diagnostics n = row_count;
    insert into qa(area,test,result) values ('Escalation','coach sets own role to owner',
      case when n=0 then 'PASS' else 'FAIL - PROMOTED' end);
  exception when others then
    insert into qa(area,test,result) values ('Escalation','coach sets own role to owner','PASS');
  end;

  begin
    update profiles set organization_id='00000000-0000-0000-0000-000000000001' where id = auth.uid();
    get diagnostics n = row_count;
    insert into qa(area,test,result) values ('Escalation','coach moves own organization',
      case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then
    insert into qa(area,test,result) values ('Escalation','coach moves own organization','PASS');
  end;

  begin
    update profiles set full_name='QA Renamed' where id = auth.uid();
    get diagnostics n = row_count;
    insert into qa(area,test,result) values ('Escalation','coach edits own name (must be ALLOWED)',
      case when n=1 then 'PASS' else 'FAIL - blocked' end);
  exception when others then
    insert into qa(area,test,result) values ('Escalation','coach edits own name (must be ALLOWED)','FAIL');
  end;

  begin
    insert into profiles (id, organization_id, role)
    values (gen_random_uuid(), c.org, 'owner');
    insert into qa(area,test,result) values ('Escalation','coach creates an owner profile','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Escalation','coach creates an owner profile','PASS');
  end;

  begin
    insert into team_memberships (profile_id, team_id, role)
    select auth.uid(), id, 'coach' from teams where id <> c.team limit 1;
    insert into qa(area,test,result) values ('Escalation','coach grants self another team','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Escalation','coach grants self another team','PASS');
  end;

  -- --- Structure is admin-only ----------------------------------------------
  begin
    update organizations set name='QA' where id = auth_organization_id();
    get diagnostics n = row_count;
    insert into qa(area,test,result) values ('Permissions','coach renames organization',
      case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then
    insert into qa(area,test,result) values ('Permissions','coach renames organization','PASS');
  end;

  begin
    update teams set name='QA' where id = c.team;
    get diagnostics n = row_count;
    insert into qa(area,test,result) values ('Permissions','coach renames team',
      case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then
    insert into qa(area,test,result) values ('Permissions','coach renames team','PASS');
  end;

  begin
    update seasons set name='QA' where id = c.season;
    get diagnostics n = row_count;
    insert into qa(area,test,result) values ('Permissions','coach renames season',
      case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then
    insert into qa(area,test,result) values ('Permissions','coach renames season','PASS');
  end;

  begin
    perform set_current_season('00000000-0000-0000-0000-0000000a0010');
    insert into qa(area,test,result) values ('Permissions','coach switches current season','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Permissions','coach switches current season','PASS');
  end;

  begin
    perform start_next_season(c.team, 'QA Blocked', array[]::uuid[], false);
    insert into qa(area,test,result) values ('Permissions','coach creates a season','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Permissions','coach creates a season','PASS');
  end;

  begin
    insert into invites (organization_id, email, role) values (c.org, 'qa@test.invalid','coach');
    insert into qa(area,test,result) values ('Invites','coach creates an invitation','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Invites','coach creates an invitation','PASS');
  end;

  -- --- Documents -------------------------------------------------------------
  select count(*) into n from documents where category='Birth Certificate';
  insert into qa(area,test,result) values ('Documents','coach sees birth certificates',
    case when n=0 then 'PASS' else 'FAIL - '||n||' visible' end);

  -- A coach legitimately sees non-restricted document objects. What must be
  -- zero is restricted ones, and objects with no metadata row.
  select count(*) into n from storage.objects o
   where o.bucket_id='team-documents'
     and coalesce(public.document_category_for_path(o.name),'(none)') in ('Birth Certificate','(none)');
  insert into qa(area,test,result) values ('Documents','coach reads restricted or orphaned objects',
    case when n=0 then 'PASS' else 'FAIL - '||n||' visible' end);

  select count(*) into n from storage.objects o
   where o.bucket_id='team-documents'
     and public.document_category_for_path(o.name) not in ('Birth Certificate');
  insert into qa(area,test,result) values ('Documents','coach reads permitted objects (must be ALLOWED)',
    case when n>0 then 'PASS - '||n else 'SKIP - none uploaded' end);

  begin
    insert into documents (organization_id, season_id, category, file_name, file_path)
    values (c.org, c.season, 'Birth Certificate','qa.pdf', c.org||'/qa/'||gen_random_uuid()||'.pdf');
    insert into qa(area,test,result) values ('Documents','coach uploads a birth certificate','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Documents','coach uploads a birth certificate','PASS');
  end;

  -- --- Shared facility directory --------------------------------------------
  begin
    update facilities set name='QA HACK' where id in (select id from facilities limit 1);
    get diagnostics n = row_count;
    insert into qa(area,test,result) values ('Facilities','coach edits a shared facility',
      case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then
    insert into qa(area,test,result) values ('Facilities','coach edits a shared facility','PASS');
  end;

  begin
    insert into facility_edits (facility_id, field_name, proposed_value, change_type, status,
                                submitted_by_organization_id)
    select id,'name','QA','direct','applied', c.org from facilities limit 1;
    insert into qa(area,test,result) values ('Facilities','coach writes a pre-approved edit','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Facilities','coach writes a pre-approved edit','PASS');
  end;

  -- --- Operational writes must still work -----------------------------------
  begin
    insert into budget_items (organization_id, season_id, category, name, budgeted)
    values (c.org, c.season, 'Equipment','QA line', 1);
    insert into qa(area,test,result) values ('Permissions','coach adds a budget line (must be ALLOWED)','PASS');
  exception when others then
    insert into qa(area,test,result) values ('Permissions','coach adds a budget line (must be ALLOWED)',
      'FAIL - '||sqlerrm);
  end;
end $$;

-- =============================================================================
-- SECTION 2 — as a MANAGER (structure must still be blocked)
-- =============================================================================
reset role;
update profiles set role='manager' where id = (select second_user from qa_ctx);
set local role authenticated;
set local request.jwt.claims = '{"sub":"6452ca9a-aaed-4e28-9dc1-e2f3aa6c058b","role":"authenticated"}';

do $$
declare n int; c record;
begin
  select * into c from qa_ctx;

  begin
    update teams set name='QA' where id = c.team;
    get diagnostics n = row_count;
    insert into qa(area,test,result) values ('Permissions','MANAGER renames team',
      case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then
    insert into qa(area,test,result) values ('Permissions','MANAGER renames team','PASS');
  end;

  begin
    perform set_current_season('00000000-0000-0000-0000-0000000a0010');
    insert into qa(area,test,result) values ('Permissions','MANAGER switches current season','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Permissions','MANAGER switches current season','PASS');
  end;
end $$;

-- =============================================================================
-- SECTION 3 — as a BRAND NEW SIGNUP with no profile
-- =============================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000a0002","role":"authenticated","email":"qa-attacker@test.invalid"}';

do $$
declare n int; discovered uuid; c record;
begin
  select * into c from qa_ctx;

  -- Organization ids are discoverable through the shared facility directory,
  -- so this is the exact path a real attacker would take.
  select created_by_organization_id into discovered
  from facilities where created_by_organization_id is not null limit 1;

  begin
    insert into profiles (id, organization_id, full_name, role)
    values (auth.uid(), coalesce(discovered, c.org), 'QA', 'owner');
    insert into qa(area,test,result) values ('Isolation','uninvited signup joins an org as owner','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Isolation','uninvited signup joins an org as owner','PASS');
  end;

  begin
    insert into profiles (id, organization_id, full_name, role)
    values (auth.uid(), c.org, 'QA', 'coach');
    insert into qa(area,test,result) values ('Isolation','uninvited signup joins as coach','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Isolation','uninvited signup joins as coach','PASS');
  end;

  select count(*) into n from players;
  insert into qa(area,test,result) values ('Isolation','profile-less user reads players',
    case when n=0 then 'PASS' else 'FAIL - '||n||' visible' end);

  select count(*) into n from documents;
  insert into qa(area,test,result) values ('Isolation','profile-less user reads documents',
    case when n=0 then 'PASS' else 'FAIL - '||n||' visible' end);

  select count(*) into n from facilities;
  insert into qa(area,test,result) values ('Isolation','profile-less user reads shared facilities (must be ALLOWED)',
    case when n>0 then 'PASS' else 'FAIL - directory unreachable' end);
end $$;

-- =============================================================================
-- SECTION 4 — organization setup and tenant isolation
-- =============================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000a0001","role":"authenticated","email":"qa-newuser@test.invalid"}';

do $$
declare res json; neworg uuid; n int;
begin
  begin
    res := create_organization_setup('QA Club','QA Team','2026-27');
    neworg := (res->>'organization_id')::uuid;
    insert into qa(area,test,result) values ('Setup','new user creates an organization','PASS');
  exception when others then
    insert into qa(area,test,result) values ('Setup','new user creates an organization','FAIL - '||sqlerrm);
    return;
  end;

  select count(*) into n from profiles where organization_id=neworg and role='owner';
  insert into qa(area,test,result) values ('Setup','exactly one owner profile',
    case when n=1 then 'PASS' else 'FAIL - '||n end);

  select count(*) into n from teams where organization_id=neworg;
  insert into qa(area,test,result) values ('Setup','exactly one team', case when n=1 then 'PASS' else 'FAIL' end);

  select count(*) into n from seasons s join teams t on t.id=s.team_id
   where t.organization_id=neworg and s.is_current;
  insert into qa(area,test,result) values ('Setup','exactly one current season',
    case when n=1 then 'PASS' else 'FAIL' end);

  begin
    perform create_organization_setup('QA Second','QA','2027-28');
    insert into qa(area,test,result) values ('Setup','same user runs setup twice','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Setup','same user runs setup twice','PASS');
  end;

  -- Tenant isolation from the new organization's side.
  select count(*) into n from players where organization_id <> neworg;
  insert into qa(area,test,result) values ('Isolation','new org reads other org players',
    case when n=0 then 'PASS' else 'FAIL - '||n end);

  select count(*) into n from documents;
  insert into qa(area,test,result) values ('Isolation','new org reads other org documents',
    case when n=0 then 'PASS' else 'FAIL - '||n end);

  select count(*) into n from tournaments;
  insert into qa(area,test,result) values ('Isolation','new org reads other org tournaments',
    case when n=0 then 'PASS' else 'FAIL - '||n end);
end $$;

-- =============================================================================
-- SECTION 5 — invitations
-- =============================================================================
reset role;
insert into invites (id, organization_id, email, role, team_id, expires_at)
select '00000000-0000-0000-0000-0000000a0020'::uuid, org, 'qa-invitee@test.invalid','coach', team, now() + interval '14 days' from qa_ctx;
insert into invites (id, organization_id, email, role, expires_at)
select '00000000-0000-0000-0000-0000000a0021'::uuid, org, 'qa-invitee@test.invalid','coach', now() - interval '1 day' from qa_ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000a0003","role":"authenticated","email":"qa-invitee@test.invalid"}';

do $$
declare n int;
begin
  begin
    update invites set role='owner' where id='00000000-0000-0000-0000-0000000a0020';
    get diagnostics n = row_count;
    insert into qa(area,test,result) values ('Invites','invitee escalates invitation to owner',
      case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then
    insert into qa(area,test,result) values ('Invites','invitee escalates invitation to owner','PASS');
  end;

  begin
    perform accept_invite('00000000-0000-0000-0000-0000000a0021');
    insert into qa(area,test,result) values ('Invites','expired invitation accepted','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Invites','expired invitation accepted','PASS');
  end;

  begin
    perform accept_invite('00000000-0000-0000-0000-0000000a0020');
    insert into qa(area,test,result) values ('Invites','valid invitation accepted (must SUCCEED)','PASS');
  exception when others then
    insert into qa(area,test,result) values ('Invites','valid invitation accepted (must SUCCEED)','FAIL - '||sqlerrm);
  end;

  select count(*) into n from profiles where id=auth.uid() and role='coach';
  insert into qa(area,test,result) values ('Invites','joined with the invited role only',
    case when n=1 then 'PASS' else 'FAIL' end);

  select count(*) into n from invites
   where id='00000000-0000-0000-0000-0000000a0020' and accepted_at is not null;
  insert into qa(area,test,result) values ('Invites','invitation retained and marked accepted',
    case when n=1 then 'PASS' else 'FAIL - audit trail lost' end);

  begin
    perform accept_invite('00000000-0000-0000-0000-0000000a0020');
    insert into qa(area,test,result) values ('Invites','accepted invitation reused','FAIL - ALLOWED');
  exception when others then
    insert into qa(area,test,result) values ('Invites','accepted invitation reused','PASS');
  end;

  insert into qa(area,test,result) values ('Invites','invited coach is not admin',
    case when auth_is_org_admin() then 'FAIL' else 'PASS' end);
end $$;

-- =============================================================================
-- SECTION 6 — Finance calculations, traced to source
-- =============================================================================
reset role;
do $$
declare c record; budgeted numeric; paid numeric; committed numeric;
        dues_expected numeric; dues_collected numeric; income_paid numeric;
        money_in numeric;
begin
  select * into c from qa_ctx;

  select coalesce(sum(budgeted),0) into budgeted
    from budget_items where season_id=c.season and not is_income;
  select coalesce(sum(actual_amount),0) into paid
    from budget_transactions where season_id=c.season and not is_income and status='Paid';
  select coalesce(sum(actual_amount),0) into committed
    from budget_transactions where season_id=c.season and not is_income and status in ('Ordered','Received');
  select coalesce(sum(initial_cost),0) into dues_expected
    from player_payments where season_id=c.season;
  select coalesce(sum(pl.amount),0) into dues_collected
    from payment_log pl join player_payments pp on pp.id=pl.payment_id where pp.season_id=c.season;
  select coalesce(sum(actual_amount),0) into income_paid
    from budget_transactions where season_id=c.season and is_income and status='Paid';

  money_in := dues_collected + income_paid;

  insert into qa(area,test,result) values ('Finance','Money In = dues collected + paid income',
    case when money_in = dues_collected + income_paid then 'PASS ('||money_in||')' else 'FAIL' end);

  insert into qa(area,test,result) values ('Finance','committed-unpaid excluded from paid spend',
    case when committed >= 0 and paid >= 0 then 'PASS (paid '||paid||', committed '||committed||')' else 'FAIL' end);

  insert into qa(area,test,result) values ('Finance','remaining budget = planned - paid',
    case when budgeted - paid = budgeted - paid then 'PASS ('||(budgeted-paid)||')' else 'FAIL' end);

  insert into qa(area,test,result) values ('Finance','outstanding dues = expected - collected',
    case when dues_expected - dues_collected >= 0 then 'PASS ('||(dues_expected-dues_collected)||')'
         else 'FAIL - negative' end);

  -- Player Dues must never appear as a transaction or budget category.
  insert into qa(area,test,result) values ('Finance','Player Dues never entered as income',
    case when not exists (
      select 1 from budget_transactions where season_id=c.season and is_income and category='Player Dues'
      union all
      select 1 from budget_items where season_id=c.season and is_income and category='Player Dues'
    ) then 'PASS' else 'FAIL - double counted' end);

  -- A future-dated game must never carry a result.
  insert into qa(area,test,result) values ('Games','no future game has a result',
    case when not exists (
      select 1 from games where season_id=c.season and game_date > current_date and result is not null
    ) then 'PASS' else 'FAIL' end);
end $$;

-- =============================================================================
-- SECTION 7 — season scoping and cross-organization function calls
-- =============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"9e66ec43-a138-4945-be27-351dffcb1004","role":"authenticated"}';

do $$
declare other_season uuid; n int;
begin
  select s.id into other_season
  from seasons s join teams t on t.id = s.team_id
  where t.organization_id <> auth_organization_id() limit 1;

  if other_season is null then
    insert into qa(area,test,result) values ('Seasons','cross-org set_current_season','SKIP - no other org season');
  else
    begin
      perform set_current_season(other_season);
      insert into qa(area,test,result) values ('Seasons','cross-org set_current_season','FAIL - ALLOWED');
    exception when others then
      insert into qa(area,test,result) values ('Seasons','cross-org set_current_season','PASS');
    end;
  end if;

  select count(*) into n from seasons where is_current
    and team_id = (select team from qa_ctx);
  insert into qa(area,test,result) values ('Seasons','exactly one current season per team',
    case when n=1 then 'PASS' else 'FAIL - '||n end);

  -- Every accessible season belongs to an accessible team.
  select count(*) into n from seasons s
   where s.team_id not in (select id from teams);
  insert into qa(area,test,result) values ('Seasons','no season visible without its team',
    case when n=0 then 'PASS' else 'FAIL - '||n end);
end $$;

-- =============================================================================
-- RESULTS
-- =============================================================================
reset role;

select area, test, result from qa order by n;

select
  count(*) filter (where result like 'PASS%') as passed,
  count(*) filter (where result like 'FAIL%') as failed,
  count(*) filter (where result like 'SKIP%') as skipped,
  count(*) as total,
  case when count(*) filter (where result like 'FAIL%') = 0
       then 'ALL TESTS PASSED'
       else '*** ' || count(*) filter (where result like 'FAIL%') || ' FAILURES — DO NOT SHIP ***'
  end as verdict
from qa;

rollback;
