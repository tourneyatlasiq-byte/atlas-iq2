-- Apply one reviewed player import, atomically.
--
-- SECURITY INVOKER, deliberately against the local precedent that every other
-- RPC here uses DEFINER. DEFINER would bypass RLS on players,
-- team_season_players, player_contacts and player_links — including the
-- policies added in B3 — leaving this function as the only guard. As INVOKER
-- it inherits every policy and RLS stays the authoritative control.
--
-- THIS FUNCTION EXECUTES DECISIONS; IT DOES NOT MAKE THEM. Identity matching,
-- conflict resolution, contact identity, primary selection and full_name
-- derivation all happen in the reviewed plan. Here they are validated and
-- applied.
--
-- NO PARAMETER CAN NAME A TABLE. The payload carries field values only, so a
-- tampered request can at most supply bad data, which constraints and RLS
-- then reject.
--
-- Whole-import atomicity: a function body is one transaction, so any
-- exception rolls back every row. The coach approved a reviewed set, not N
-- independent operations.
create or replace function public.intake_apply(
  p_team_id   uuid,
  p_season_id uuid,
  p_rows      jsonb
)
returns json
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_user     uuid := auth.uid();
  v_org      uuid := public.auth_organization_id();
  v_row      jsonb;
  v_player   jsonb;
  v_season   jsonb;
  v_contact  jsonb;
  v_link     jsonb;
  v_contacts jsonb;
  v_pid      uuid;
  v_is_new   boolean;
  v_full     text;
  v_ptype    text;
  v_created  int := 0;
  v_updated  int := 0;
  v_c_ins    int := 0;
  v_c_upd    int := 0;
  v_links    int := 0;
  v_primary_count int;
  v_has_primary   boolean;
  v_cid      uuid;
  v_op       text;
begin
  ------------------------------------------------------------------ identity
  if v_user is null then
    raise exception 'You must be signed in to import players.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'Your account is not attached to an organization.'
      using errcode = 'insufficient_privilege';
  end if;

  -- auth_can_write() excludes the parent role. RLS enforces this as well; the
  -- explicit check exists so a refusal reads as a sentence rather than as an
  -- empty result set.
  if not public.auth_can_write() then
    raise exception 'Your role does not allow changes to the roster.'
      using errcode = 'insufficient_privilege';
  end if;

  -- team_season_players gates on auth_team_ids() rather than organization, so
  -- a user with an org but no team membership would otherwise fail with an
  -- opaque RLS error. Checked here to give a usable message.
  if not exists (
    select 1 from seasons s join teams t on t.id = s.team_id
    where s.id = p_season_id and t.id = p_team_id and t.organization_id = v_org
  ) then
    raise exception 'That team and season do not belong to your organization.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'No rows to import.' using errcode = 'invalid_parameter_value';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_player   := coalesce(v_row -> 'player',   '{}'::jsonb);
    v_season   := coalesce(v_row -> 'season',   '{}'::jsonb);
    v_contacts := coalesce(v_row -> 'contacts', '[]'::jsonb);
    -- is_new decides insert-vs-update on a PERSON. Defaulting a missing value
    -- to true would create a duplicate player from a malformed row.
    if v_row -> 'is_new' is null or jsonb_typeof(v_row -> 'is_new') <> 'boolean' then
      raise exception 'A row does not say whether it is a new player.'
        using errcode = 'invalid_parameter_value';
    end if;
    v_is_new := (v_row ->> 'is_new')::boolean;

    -- full_name is derived by composeFullName() in the server layer. This
    -- VALIDATES; it does not recompute. A PL/pgSQL reimplementation cannot
    -- match String.trim(), which strips all Unicode whitespace — a
    -- non-breaking space, form feed or vertical tab each diverge. One
    -- implementation, no drift.
    v_full := nullif(btrim(v_player ->> 'full_name', E' \t\r\n'), '');

    --------------------------------------------------------------- person_type
    -- players.person_type defaults to 'player' and is constrained to
    -- player | coach | manager | other. An EXPLICIT NULL would NOT invoke the
    -- default, and person_type gates dues and lineup eligibility across ~21
    -- call sites — so a null here would quietly drop someone from dues.
    --
    -- The key is therefore omitted entirely when absent, letting the column
    -- default apply exactly as addRosterMember does. A refused value ("Staff",
    -- an unknown role) never reaches this function: the normaliser sends
    -- nothing and the review step blocks the row.
    v_ptype := nullif(btrim(v_player ->> 'person_type', E' \t\r\n'), '');
    if v_ptype is not null and v_ptype not in ('player','coach','manager','other') then
      raise exception 'Unrecognised person type in import: %', v_ptype
        using errcode = 'invalid_parameter_value';
    end if;

    if v_is_new then
      if v_full is null then
        raise exception 'A row has no player name.' using errcode = 'invalid_parameter_value';
      end if;

      -- Two inserts rather than one, so an absent person_type genuinely takes
      -- the column default instead of an explicit null.
      if v_ptype is null then
        insert into players (
          organization_id, full_name, legal_first_name, preferred_first_name,
          last_name, high_school, grad_year, date_of_birth, bats, throws,
          player_email, player_phone, notes
        ) values (
          v_org, v_full,
          nullif(btrim(v_player ->> 'legal_first_name',     E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'preferred_first_name', E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'last_name',            E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'high_school',          E' \t\r\n'), ''),
          (nullif(btrim(v_player ->> 'grad_year',     E' \t\r\n'), ''))::int,
          (nullif(btrim(v_player ->> 'date_of_birth', E' \t\r\n'), ''))::date,
          nullif(btrim(v_player ->> 'bats',         E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'throws',       E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'player_email', E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'player_phone', E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'notes',        E' \t\r\n'), '')
        ) returning id into v_pid;
      else
        insert into players (
          organization_id, full_name, legal_first_name, preferred_first_name,
          last_name, high_school, grad_year, date_of_birth, bats, throws,
          player_email, player_phone, notes, person_type, other_role_label
        ) values (
          v_org, v_full,
          nullif(btrim(v_player ->> 'legal_first_name',     E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'preferred_first_name', E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'last_name',            E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'high_school',          E' \t\r\n'), ''),
          (nullif(btrim(v_player ->> 'grad_year',     E' \t\r\n'), ''))::int,
          (nullif(btrim(v_player ->> 'date_of_birth', E' \t\r\n'), ''))::date,
          nullif(btrim(v_player ->> 'bats',         E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'throws',       E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'player_email', E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'player_phone', E' \t\r\n'), ''),
          nullif(btrim(v_player ->> 'notes',        E' \t\r\n'), ''),
          v_ptype,
          nullif(btrim(v_player ->> 'other_role_label', E' \t\r\n'), '')
        ) returning id into v_pid;
      end if;
      v_created := v_created + 1;

    else
      v_pid := (v_row ->> 'player_id')::uuid;
      if v_pid is null then
        raise exception 'An existing-player row is missing its player.'
          using errcode = 'invalid_parameter_value';
      end if;

      -- ONLY APPROVED KEYS, and never an erase. Key PRESENCE says the
      -- reviewer approved that field; coalesce() means a blank, whitespace or
      -- tampered value still cannot clear a stored one. Clearing a field is
      -- not an approved product feature and no path supports it.
      update players set
        legal_first_name = case when v_player ? 'legal_first_name'
          then coalesce(nullif(btrim(v_player ->> 'legal_first_name', E' \t\r\n'), ''), legal_first_name)
          else legal_first_name end,
        preferred_first_name = case when v_player ? 'preferred_first_name'
          then coalesce(nullif(btrim(v_player ->> 'preferred_first_name', E' \t\r\n'), ''), preferred_first_name)
          else preferred_first_name end,
        last_name = case when v_player ? 'last_name'
          then coalesce(nullif(btrim(v_player ->> 'last_name', E' \t\r\n'), ''), last_name)
          else last_name end,
        high_school = case when v_player ? 'high_school'
          then coalesce(nullif(btrim(v_player ->> 'high_school', E' \t\r\n'), ''), high_school)
          else high_school end,
        grad_year = case when v_player ? 'grad_year'
          then coalesce((nullif(btrim(v_player ->> 'grad_year', E' \t\r\n'), ''))::int, grad_year)
          else grad_year end,
        date_of_birth = case when v_player ? 'date_of_birth'
          then coalesce((nullif(btrim(v_player ->> 'date_of_birth', E' \t\r\n'), ''))::date, date_of_birth)
          else date_of_birth end,
        bats = case when v_player ? 'bats'
          then coalesce(nullif(btrim(v_player ->> 'bats', E' \t\r\n'), ''), bats) else bats end,
        throws = case when v_player ? 'throws'
          then coalesce(nullif(btrim(v_player ->> 'throws', E' \t\r\n'), ''), throws) else throws end,
        player_email = case when v_player ? 'player_email'
          then coalesce(nullif(btrim(v_player ->> 'player_email', E' \t\r\n'), ''), player_email)
          else player_email end,
        player_phone = case when v_player ? 'player_phone'
          then coalesce(nullif(btrim(v_player ->> 'player_phone', E' \t\r\n'), ''), player_phone)
          else player_phone end,
        notes = case when v_player ? 'notes'
          then coalesce(nullif(btrim(v_player ->> 'notes', E' \t\r\n'), ''), notes) else notes end,
        person_type = case when v_ptype is not null then v_ptype else person_type end,
        other_role_label = case when v_player ? 'other_role_label'
          then nullif(btrim(v_player ->> 'other_role_label', E' \t\r\n'), '')
          else other_role_label end,
        -- Server-derived; applied only when supplied.
        full_name = coalesce(v_full, full_name)
      where id = v_pid and organization_id = v_org;

      if not found then
        raise exception 'A player in this import is not in your organization.'
          using errcode = 'insufficient_privilege';
      end if;
      v_updated := v_updated + 1;
    end if;

    ------------------------------------------------------------ season member
    -- is_active is set ONLY on insert. Re-importing a player who was removed
    -- from the season must never silently reactivate them: that would
    -- override the removal lifecycle. Season fields change only when the key
    -- is present, so an omitted column is untouched by contract rather than
    -- by accident.
    insert into team_season_players (
      player_id, team_id, season_id, jersey_number, jersey_size, pants_size,
      positions, position, is_active
    ) values (
      v_pid, p_team_id, p_season_id,
      (nullif(btrim(v_season ->> 'jersey_number', E' \t\r\n'), ''))::int,
      nullif(btrim(v_season ->> 'jersey_size', E' \t\r\n'), ''),
      nullif(btrim(v_season ->> 'pants_size',  E' \t\r\n'), ''),
      case when v_season ? 'positions'
           then array(select jsonb_array_elements_text(v_season -> 'positions')) end,
      case when v_season ? 'positions'
           then (select x from jsonb_array_elements_text(v_season -> 'positions') x limit 1) end,
      true
    )
    on conflict (player_id, season_id) do update set
      jersey_number = case when v_season ? 'jersey_number'
        then coalesce(excluded.jersey_number, team_season_players.jersey_number)
        else team_season_players.jersey_number end,
      jersey_size = case when v_season ? 'jersey_size'
        then coalesce(excluded.jersey_size, team_season_players.jersey_size)
        else team_season_players.jersey_size end,
      pants_size = case when v_season ? 'pants_size'
        then coalesce(excluded.pants_size, team_season_players.pants_size)
        else team_season_players.pants_size end,
      positions = case when v_season ? 'positions'
        then excluded.positions else team_season_players.positions end,
      position = case when v_season ? 'positions'
        then excluded.position else team_season_players.position end;
      -- is_active deliberately absent from the update.

    ----------------------------------------------------------------- contacts
    -- The plan states insert or update and, for an update, which contact.
    -- This function matches nothing itself.
    select exists (select 1 from player_contacts where player_id = v_pid and is_primary)
      into v_has_primary;

    -- Contract validation BEFORE writing, so a malformed payload produces a
    -- readable error rather than a uniqueness exception from the partial
    -- index. The index remains the final safeguard.
    select count(*) into v_primary_count
      from jsonb_array_elements(v_contacts) c
      where coalesce((c ->> 'is_primary')::boolean, false);

    if v_is_new and jsonb_array_length(v_contacts) > 0 and v_primary_count <> 1 then
      raise exception 'A new player must have exactly one primary contact; the import supplied %.',
        v_primary_count using errcode = 'invalid_parameter_value';
    end if;

    if not v_is_new and v_has_primary and v_primary_count > 0 then
      raise exception 'This player already has a primary contact. An import cannot change it.'
        using errcode = 'invalid_parameter_value';
    end if;

    -- With no existing primary, an import does not silently promote one.
    if not v_is_new and not v_has_primary and v_primary_count > 0 then
      raise exception 'An import cannot choose a primary contact for an existing player.'
        using errcode = 'invalid_parameter_value';
    end if;

    for v_contact in select * from jsonb_array_elements(v_contacts)
    loop
      -- EXPLICIT ALLOWLIST. A missing, malformed or tampered operation must
      -- not fall through to a mutation: "anything that isn't update is an
      -- insert" turns a typo into a duplicate contact.
      v_op := nullif(btrim(v_contact ->> 'op', E' \t\r\n'), '');
      if v_op is null or v_op not in ('insert','update') then
        raise exception 'Unsupported contact operation in import: %',
          coalesce(v_op, '(none)') using errcode = 'invalid_parameter_value';
      end if;

      if v_op = 'update' then
        v_cid := (v_contact ->> 'contact_id')::uuid;
        if v_cid is null then
          raise exception 'A contact update is missing its contact.'
            using errcode = 'invalid_parameter_value';
        end if;

        -- is_primary is deliberately NOT updatable through import.
        update player_contacts set
          full_name = coalesce(nullif(btrim(v_contact ->> 'full_name', E' \t\r\n'), ''), full_name),
          relationship = coalesce(nullif(btrim(v_contact ->> 'relationship', E' \t\r\n'), ''), relationship),
          email = coalesce(nullif(btrim(v_contact ->> 'email', E' \t\r\n'), ''), email),
          phone = coalesce(nullif(btrim(v_contact ->> 'phone', E' \t\r\n'), ''), phone),
          preferred_method = coalesce(nullif(btrim(v_contact ->> 'preferred_method', E' \t\r\n'), ''), preferred_method),
          updated_at = now()
        where id = v_cid and player_id = v_pid;   -- a foreign id cannot match

        if not found then
          raise exception 'A contact in this import does not belong to that player.'
            using errcode = 'no_data_found';
        end if;
        v_c_upd := v_c_upd + 1;

      else  -- v_op = 'insert', the only remaining possibility
        insert into player_contacts (
          organization_id, player_id, full_name, relationship, email, phone,
          preferred_method, is_primary, sort_order, created_by
        ) values (
          v_org, v_pid,
          nullif(btrim(v_contact ->> 'full_name',    E' \t\r\n'), ''),
          nullif(btrim(v_contact ->> 'relationship', E' \t\r\n'), ''),
          nullif(btrim(v_contact ->> 'email',        E' \t\r\n'), ''),
          nullif(btrim(v_contact ->> 'phone',        E' \t\r\n'), ''),
          nullif(btrim(v_contact ->> 'preferred_method', E' \t\r\n'), ''),
          coalesce((v_contact ->> 'is_primary')::boolean, false),
          coalesce((nullif(btrim(v_contact ->> 'sort_order', E' \t\r\n'), ''))::int, 0),
          v_user
        );
        v_c_ins := v_c_ins + 1;
      end if;
    end loop;

    -------------------------------------------------------------------- links
    -- The coach's original string is preserved verbatim in label; only url is
    -- composed, by the server layer.
    for v_link in select * from jsonb_array_elements(coalesce(v_row -> 'links', '[]'::jsonb))
    loop
      -- Same fail-closed principle: only the supported link type is written.
      if nullif(btrim(v_link ->> 'link_type', E' \t\r\n'), '') is distinct from 'X' then
        raise exception 'Unsupported link type in import: %',
          coalesce(nullif(btrim(v_link ->> 'link_type', E' \t\r\n'), ''), '(none)')
          using errcode = 'invalid_parameter_value';
      end if;
      if nullif(btrim(v_link ->> 'url', E' \t\r\n'), '') is null then
        raise exception 'A social link has no address.'
          using errcode = 'invalid_parameter_value';
      end if;

      if not exists (
        select 1 from player_links
        where player_id = v_pid and link_type = 'X' and url = v_link ->> 'url'
      ) then
        insert into player_links (organization_id, player_id, link_type, url, label)
        values (v_org, v_pid, 'X', v_link ->> 'url',
                nullif(btrim(v_link ->> 'label', E' \t\r\n'), ''));
        v_links := v_links + 1;
      end if;
    end loop;

  end loop;

  return json_build_object(
    'created', v_created, 'updated', v_updated,
    'contacts_added', v_c_ins, 'contacts_updated', v_c_upd,
    'links_added', v_links
  );
end;
$$;

-- Only signed-in users may call this. Supabase grants EXECUTE to anon and
-- authenticated by default; anon would fail at RLS regardless, but it should
-- not be able to enter the function at all. auth_linked_player_ids is the
-- existing precedent for an authenticated-only routine.
revoke all on function public.intake_apply(uuid, uuid, jsonb) from public, anon;
grant execute on function public.intake_apply(uuid, uuid, jsonb) to authenticated;

comment on function public.intake_apply is
  'Applies one reviewed player import atomically. SECURITY INVOKER so RLS remains authoritative. Executes reviewed decisions; makes none. No parameter can name a destination table.';
