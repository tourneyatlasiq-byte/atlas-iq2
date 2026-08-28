-- Player mailing address.
--
-- Colleges mail recruiting material directly to players, so the address
-- belongs to the PLAYER, not to a guardian contact: it is where the athlete
-- receives post, and it survives a change of guardian.
--
-- Naming follows facilities (street_address / city / state / zip) rather than
-- inventing address_line1 / postal_code, so the product has one address
-- vocabulary and the shared address-lookup component can serve both. line 2 is
-- added here because players need it; facilities may gain it later.
--
-- All nullable, no defaults, no backfill. players RLS is column-agnostic, so
-- no policy changes.
alter table players
  add column if not exists street_address   text,
  add column if not exists street_address_2 text,
  add column if not exists city             text,
  add column if not exists state            text,
  add column if not exists zip              text;

comment on column players.street_address is
  'Mailing address for recruiting post. Player-level, not contact-level.';

-- roster_add_member: accept every field the Add Player form can send.
--
-- The RPC reads an explicit key list, so anything absent from it was accepted
-- by the form and silently discarded on insert. An audit of playerFields()
-- against the accepted keys found FOUR such fields: high_school, and the three
-- structured-name columns. high_school was a live loss. The structured names
-- are not currently sent on Add (a new player always uses the single Name
-- field), but the contract is completed here so a later change cannot lose
-- them quietly.
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
  v_org       uuid := public.auth_organization_id();
  v_user      uuid := auth.uid();
  v_player_id uuid;
  v_contact_id uuid;
  v_full      text;
  v_ptype     text;
  v_positions text[];
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'Your account is not attached to an organization.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.auth_can_write() then
    raise exception 'Your role does not allow changes to the roster.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from seasons s join teams t on t.id = s.team_id
    where s.id = p_season_id and t.id = p_team_id and t.organization_id = v_org
  ) then
    raise exception 'That team and season do not belong to your organization.'
      using errcode = 'insufficient_privilege';
  end if;

  v_full := nullif(btrim(p_player ->> 'full_name', E' \t\r\n'), '');
  if v_full is null then
    raise exception 'Enter a name.' using errcode = 'invalid_parameter_value';
  end if;

  v_ptype := nullif(btrim(p_player ->> 'person_type', E' \t\r\n'), '');
  if v_ptype is not null and v_ptype not in ('player','coach','manager','other') then
    raise exception 'Unrecognised person type: %', v_ptype
      using errcode = 'invalid_parameter_value';
  end if;

  if v_ptype is null then
    insert into players (
      organization_id, full_name, other_role_label, grad_year, date_of_birth,
      throws, bats, player_email, player_phone, notes,
      high_school, street_address, street_address_2, city, state, zip,
      legal_first_name, preferred_first_name, last_name
    ) values (
      v_org, v_full,
      nullif(btrim(p_player ->> 'other_role_label', E' \t\r\n'), ''),
      (nullif(btrim(p_player ->> 'grad_year',     E' \t\r\n'), ''))::int,
      (nullif(btrim(p_player ->> 'date_of_birth', E' \t\r\n'), ''))::date,
      nullif(btrim(p_player ->> 'throws',       E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'bats',         E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'player_email', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'player_phone', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'notes',        E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'high_school',      E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'street_address',   E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'street_address_2', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'city',             E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'state',            E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'zip',              E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'legal_first_name',     E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'preferred_first_name', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'last_name',            E' \t\r\n'), '')
    ) returning id into v_player_id;
  else
    insert into players (
      organization_id, full_name, person_type, other_role_label, grad_year,
      date_of_birth, throws, bats, player_email, player_phone, notes,
      high_school, street_address, street_address_2, city, state, zip,
      legal_first_name, preferred_first_name, last_name
    ) values (
      v_org, v_full, v_ptype,
      nullif(btrim(p_player ->> 'other_role_label', E' \t\r\n'), ''),
      (nullif(btrim(p_player ->> 'grad_year',     E' \t\r\n'), ''))::int,
      (nullif(btrim(p_player ->> 'date_of_birth', E' \t\r\n'), ''))::date,
      nullif(btrim(p_player ->> 'throws',       E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'bats',         E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'player_email', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'player_phone', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'notes',        E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'high_school',      E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'street_address',   E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'street_address_2', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'city',             E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'state',            E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'zip',              E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'legal_first_name',     E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'preferred_first_name', E' \t\r\n'), ''),
      nullif(btrim(p_player ->> 'last_name',            E' \t\r\n'), '')
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
    case when v_positions is not null then v_positions[1] end,
    true
  );

  ---------------------------------------------------------------- contact
  -- Optional. A brand-new player provably has no contacts, so one primary is
  -- unambiguous. Nothing is created when no detail was entered.
  if p_contact is not null and (
       nullif(btrim(p_contact ->> 'full_name',    E' \t\r\n'), '') is not null or
       nullif(btrim(p_contact ->> 'relationship', E' \t\r\n'), '') is not null or
       nullif(btrim(p_contact ->> 'email',        E' \t\r\n'), '') is not null or
       nullif(btrim(p_contact ->> 'phone',        E' \t\r\n'), '') is not null
     ) then
    insert into player_contacts (
      organization_id, player_id, full_name, relationship, email, phone,
      is_primary, sort_order, created_by
    ) values (
      v_org, v_player_id,
      nullif(btrim(p_contact ->> 'full_name',    E' \t\r\n'), ''),
      nullif(btrim(p_contact ->> 'relationship', E' \t\r\n'), ''),
      nullif(btrim(p_contact ->> 'email',        E' \t\r\n'), ''),
      nullif(btrim(p_contact ->> 'phone',        E' \t\r\n'), ''),
      true, 0, v_user
    ) returning id into v_contact_id;
  end if;

  return json_build_object('player_id', v_player_id, 'contact_id', v_contact_id);
end;
$$;

revoke all on function public.roster_add_member(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.roster_add_member(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

comment on function public.roster_add_member is
  'Adds a player, their season membership and an optional first contact in one transaction. SECURITY INVOKER so RLS remains authoritative.';
