-- Phase 3C-0 baseline probe (READ-ONLY by construction).
--
-- For each account listed in `uids`, impersonates that account as the `authenticated`
-- role and records, per request-pin scenario: the resolved organization / role / admin
-- / write helpers, the team ids and season count, how many rows each table exposes
-- (and how many of those belong to ANOTHER organization or team), and what a no-op
-- UPDATE of each organization-scoped table affects.
--
-- Nothing can commit: the block ALWAYS ends in RAISE EXCEPTION, which aborts the whole
-- transaction, and carries the result JSON in the error message ("BASELINE|{...}").
-- Run it with the Supabase SQL editor or the MCP execute_sql tool and read the message.
-- Put the account ids to probe in `uids`. Table list is discovered, never hard-coded.
do $baseline$
declare
  uids uuid[] := array[:UIDS]::uuid[];
  u uuid; own uuid; oth uuid; own_teams uuid[];
  scen record; res jsonb := '{}'::jsonb; sc jsonb; tb jsonb; wr jsonb; hp jsonb;
  t text; v bigint; f bigint; n bigint; n2 bigint; code text;
  org_tables text[]; team_tables text[] := array['seasons','team_memberships','team_season_players'];
  o uuid; r text; adm boolean; wri boolean; tms jsonb; sn bigint;
begin
  select array_agg(c.table_name order by c.table_name) into org_tables
    from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'organization_id' and x.table_type = 'BASE TABLE';

  foreach u in array uids loop
    select organization_id into own from organization_memberships where user_id = u;
    select id into oth from organizations where id <> own order by id limit 1;
    select coalesce(array_agg(id), '{}') into own_teams from teams where organization_id = own;
    sc := '{}'::jsonb;

    for scen in select * from (values
      ('absent',       '{}'),
      ('match',        json_build_object('x-season-tempo-org', own)::text),
      ('mismatch',     json_build_object('x-season-tempo-org', oth)::text),
      ('nonexistent',  '{"x-season-tempo-org":"00000000-0000-4000-8000-000000000999"}'),
      ('malformed',    '{"x-season-tempo-org":"not-a-uuid"}'),
      ('empty',        '{"x-season-tempo-org":""}'),
      ('duplicate',    format('{"x-season-tempo-org":"%s","X-Season-Tempo-Org":"%s"}', own, own)),
      ('commajoined',  json_build_object('x-season-tempo-org', own || ',' || oth)::text),
      ('uppercasekey', json_build_object('X-SEASON-TEMPO-ORG', own)::text)
    ) s(name, h) loop
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', u::text, true);
      perform set_config('request.headers', scen.h, true);
      execute 'set local role authenticated';

      select auth_organization_id(), auth_org_role(), auth_is_org_admin(), auth_can_write(),
             (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from auth_team_ids() x),
             (select count(*) from auth_season_ids())
        into o, r, adm, wri, tms, sn;
      sc := sc || jsonb_build_object(scen.name, jsonb_build_object(
        'org', case when o = own then 'OWN' when o is null then null else 'OTHER' end,
        'role', r, 'admin', adm, 'write', wri,
        'teams', (select coalesce(jsonb_agg(case when x::uuid = any(own_teams) then 'OWN' else 'OTHER' end), '[]'::jsonb) from jsonb_array_elements_text(tms) x),
        'seasons', sn));

      if scen.name in ('absent', 'match', 'mismatch') then
        tb := '{}'::jsonb; wr := '{}'::jsonb;
        select count(*), count(*) filter (where id <> own) into v, f from organizations;
        if v > 0 then tb := tb || jsonb_build_object('organizations', jsonb_build_array(v, f)); end if;
        foreach t in array org_tables loop
          execute format('select count(*), count(*) filter (where organization_id is distinct from %L) from public.%I', own, t) into v, f;
          if v > 0 then tb := tb || jsonb_build_object(t, jsonb_build_array(v, f)); end if;
        end loop;
        foreach t in array team_tables loop
          execute format('select count(*), count(*) filter (where not (team_id = any(%L::uuid[]))) from public.%I', own_teams, t) into v, f;
          if v > 0 then tb := tb || jsonb_build_object(t, jsonb_build_array(v, f)); end if;
        end loop;
        -- no-op UPDATE probes (aborted with everything else): rows the account may update
        -- in its own organization, then rows it may update in any other organization.
        foreach t in array org_tables loop
          n := null; n2 := null; code := null;
          begin
            execute format('update public.%I set organization_id = organization_id where organization_id = %L', t, own);
            get diagnostics n = row_count;
            execute format('update public.%I set organization_id = organization_id where organization_id is distinct from %L', t, own);
            get diagnostics n2 = row_count;
          exception when others then
            code := sqlstate;
          end;
          if coalesce(n, 0) > 0 or coalesce(n2, 0) > 0 or code is not null then
            wr := wr || jsonb_build_object(t, jsonb_build_array(n, n2, code));
          end if;
        end loop;
        sc := jsonb_set(sc, array[scen.name, 'tables'], tb);
        sc := jsonb_set(sc, array[scen.name, 'updates'], wr);
      end if;

      execute 'reset role';
    end loop;

    -- Settings People list, exactly as the page reads it today (profiles of the active org),
    -- seen by this account with no pin.
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform set_config('request.headers', '{}', true);
    execute 'set local role authenticated';
    select coalesce(jsonb_agg(role order by role), '[]'::jsonb) into hp
      from profiles where organization_id = own;
    execute 'reset role';
    sc := sc || jsonb_build_object('settingsPeopleRoles', hp);

    res := res || jsonb_build_object(u::text, sc);
  end loop;

  res := res || jsonb_build_object('staleTeamAssignments',
    (select count(*) from team_memberships tm join teams t on t.id = tm.team_id
       join profiles p on p.id = tm.profile_id where t.organization_id is distinct from p.active_organization_id));
  raise exception 'BASELINE|%', res::text;
end $baseline$;
