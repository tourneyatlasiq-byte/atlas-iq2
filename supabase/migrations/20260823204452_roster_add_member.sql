-- Create a player, their season membership and an optional primary contact as
-- ONE transaction.
--
-- SECURITY INVOKER, following intake_apply rather than the nineteen DEFINER
-- functions here — every one of those is a trigger, a helper, or a genuinely
-- privileged operation. This is none of them: the caller already holds insert
-- rights on all three tables, so DEFINER would buy nothing and would move the
-- guard out of RLS and into this function.
--
-- WHY THIS EXISTS. addRosterMember() inserted the player, inserted the season
-- membership, and on failure issued a compensating DELETE against players.
-- That DELETE could never work: players has no DELETE policy (removed
-- deliberately by #177), and a DELETE matching zero rows raises nothing. Every
-- failed assignment therefore left an orphaned person record behind, silently.
-- Adding a third write to that sequence would have compounded it. A function
-- body is one transaction, so there is now nothing to compensate for.
--
-- ORGANIZATION IS NEVER TAKEN FROM THE REQUEST. It comes from
-- auth_organization_id(), and p_team_id / p_season_id are validated against
-- it, so a tampered payload cannot reach another organization.
--
-- NOTHING IS SYNTHESIZED. A contact may legitimately have no name and no
-- relationship; those stay NULL. If no contact detail is supplied at all, no
-- contact row is created — having no contact information is a valid state.
create or replace function public.roster_add_member(
  p_team_id    uuid,
  p_season_id  uuid,
  p_player     jsonb,
  p_assignment jsonb,
  p_contact    jsonb default null
)
returns json
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_user       uuid := auth.uid();
  v_org        uuid := public.auth_organization_id();
  v_player_id  uuid;
  v_full       text;
  v_ptype      text;
  v_c_name     text;
  v_c_rel      text;
  v_c_email    text;
  v_c_phone    text;
  v_c_method   text;
  v_contact_id uuid := null;
  v_positions  text[];
begin
  ------------------------------------------------------------------ identity
  if v_user is null then
    raise exception 'You must be signed in to add someone to the roster.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'Your account is not attached to an organization.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.auth_can_write() then
    raise exception 'Your role does not allow changes to the roster.'
      using errcode = 'insufficient_privilege';
  end if;

  -- team_season_players gates on auth_team_ids() rather than organization, so
  -- without this an unaffiliated user would fail with an opaque RLS error.
  if not exists (
    select 1 from seasons s join teams t on t.id = s.team_id
    where s.id = p_season_id and t.id = p_team_id and t.organization_id = v_org
  ) then
    raise exception 'That team and season do not belong to your organization.'
      using errcode = 'insufficient_privilege';
  end if;

  --------------------------------------------------------------------- player
  v_full := nullif(btrim(p_player ->> 'full_name', E' \t\r\n'), '');
  if v_full is null then
    raise exception 'Enter a name.' using errcode = 'invalid_parameter_value';
  end if;

  -- person_type is constrained to player|coach|manager|other and defaults to
  -- 'player'. An explicit NULL would NOT take the default, and person_type
  -- gates dues and lineup eligibility, so the key is omitted when absent.
  v_ptype := nullif(btrim(p_player ->> 'person_type', E' \t\r\n'), '');
  if v_ptype is not null and v_ptype not in ('player','coach','manager','other') then
    raise exception 'Unrecognised person type: %', v_ptype
      using errcode = 'invalid_parameter_value';
  end if;

  if v_ptype is null then
    insert into players (
      organization_id, full_name, other_role_label, grad_year, date_of_birth,
      throws, bats, player_email, player_phone, notes
    ) values (
      v_org, v_full,
      nullif(btrim(p_player ->> 'other_role_label', E' \t\r\n'), ''),
      (nullif(btrim(p_player ->> 'grad_year',     E' \t\r\n'), ''))::int,
      (nullif(btrim(p_player ->> 'date_of_birth', E' \t\r\n'), ''))::date,
      nullif(btrim(p_player ->> 'throws',       E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'bats',         E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'player_email', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'player_phone', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'notes',        E' \t\r\n'), '')
    ) returning id into v_player_id;
  else
    insert into players (
      organization_id, full_name, person_type, other_role_label, grad_year,
      date_of_birth, throws, bats, player_email, player_phone, notes
    ) values (
      v_org, v_full, v_ptype,
      nullif(btrim(p_player ->> 'other_role_label', E' \t\r\n'), ''),
      (nullif(btrim(p_player ->> 'grad_year',     E' \t\r\n'), ''))::int,
      (nullif(btrim(p_player ->> 'date_of_birth', E' \t\r\n'), ''))::date,
      nullif(btrim(p_player ->> 'throws',       E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'bats',         E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'player_email', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'player_phone', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'notes',        E' \t\r\n'), '')
    ) returning id into v_player_id;
  end if;

  -- players.parent_name / parent_email / parent_phone are DELIBERATELY absent.
  -- They are legacy read-fallback columns and nothing writes them any more.

  ------------------------------------------------------------ season member
  v_positions := case
    when p_assignment ? 'positions' and jsonb_typeof(p_assignment -> 'positions') = 'array'
    then array(select jsonb_array_elements_text(p_assignment -> 'positions'))
    else null end;

  insert into team_season_players (
    player_id, team_id, season_id, jersey_number, jersey_size, pants_size,
    positions, position, is_active
  ) values (
    v_player_id, p_team_id, p_season_id,
    (nullif(btrim(p_assignment ->> 'jersey_number', E' \t\r\n'), ''))::int,
    nullif(btrim(p_assignment ->> 'jersey_size', E' \t\r\n'), ''),
    nullif(btrim(p_assignment ->> 'pants_size',  E' \t\r\n'), ''),
    v_positions,
    v_positions[1],
    coalesce((p_assignment ->> 'is_active')::boolean, true)
  );

  ----------------------------------------------------------------- contact
  -- Created only when something was actually supplied. All-blank is not an
  -- error: a player with no contact information is a valid record, and
  -- player_contacts_has_detail would reject an empty row anyway.
  if p_contact is not null and jsonb_typeof(p_contact) = 'object' then
    v_c_name   := nullif(btrim(p_contact ->> 'full_name',    E' \t\r\n'), '');
    v_c_rel    := nullif(btrim(p_contact ->> 'relationship', E' \t\r\n'), '');
    v_c_email  := nullif(btrim(p_contact ->> 'email',        E' \t\r\n'), '');
    v_c_phone  := nullif(btrim(p_contact ->> 'phone',        E' \t\r\n'), '');
    v_c_method := nullif(btrim(p_contact ->> 'preferred_method', E' \t\r\n'), '');

    if v_c_method is not null and v_c_method not in ('text','email','call') then
      raise exception 'Unrecognised preferred contact method: %', v_c_method
        using errcode = 'invalid_parameter_value';
    end if;

    if v_c_name is not null or v_c_rel is not null
       or v_c_email is not null or v_c_phone is not null then
      -- is_primary is safe unconditionally: the player was created in this
      -- same transaction, so it provably holds no other contact and the
      -- partial unique index cannot be violated.
      insert into player_contacts (
        organization_id, player_id, full_name, relationship, email, phone,
        preferred_method, is_primary, sort_order, created_by
      ) values (
        v_org, v_player_id, v_c_name, v_c_rel, v_c_email, v_c_phone,
        v_c_method, true, 0, v_user
      ) returning id into v_contact_id;
    end if;
  end if;

  return json_build_object(
    'player_id',  v_player_id,
    'contact_id', v_contact_id,
    'person_type', coalesce(v_ptype, 'player')
  );
end;
$$;

revoke all on function public.roster_add_member(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.roster_add_member(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

comment on function public.roster_add_member is
  'Creates a player, season membership and optional primary contact atomically. SECURITY INVOKER so RLS remains authoritative. Organization comes from auth_organization_id(), never the payload. Never writes players.parent_*.';
