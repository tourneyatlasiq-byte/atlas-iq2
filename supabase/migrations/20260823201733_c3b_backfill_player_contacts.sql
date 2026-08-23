-- C3b: migrate the legacy players.parent_* columns into player_contacts.
--
-- Twenty-five players carry contact details in three columns that predate
-- player_contacts. C3a made the roster and readiness read through
-- resolvePlayerContact(), which prefers player_contacts and falls back to
-- these columns, so this backfill moves each player from the fallback path to
-- the authoritative one WITHOUT changing anything a coach sees.
--
-- NOTHING IS SYNTHESIZED. Sixteen of the twenty-five have no parent_name:
-- full_name stays NULL rather than becoming "Parent/Guardian" or "Parent of
-- <player>", which would put a string the coach never typed in front of them
-- looking like recorded data. relationship is NULL for all twenty-five because
-- these columns never captured it, and guessing "Mother" from an email address
-- is invention, not migration.
--
-- THE LEGACY COLUMNS ARE NOT CLEARED. Reads already prefer player_contacts, so
-- leaving parent_* in place costs nothing and keeps a verifiable copy of the
-- source data. Retiring those columns is a later, separate decision.
--
-- NOT EXISTS does three jobs at once, inside one atomic INSERT ... SELECT:
--   1. rerun safety   — after the first run no candidate remains
--   2. duplicate guard — a player holding any contact row is skipped
--   3. precedence     — legacy never competes with a real record, matching
--                       the row-level precedence C3a already enforces
--
-- No uniqueness constraint is added for this. Families legitimately share a
-- phone number, and a constraint written for a one-time backfill would sit in
-- the schema forever rejecting valid future contacts.
do $$
declare
  v_candidates int;
  v_non_player int;
  v_no_org     int;
  v_inserted   int;
  v_named      int;
  v_nameless   int;
  v_email      int;
  v_phone      int;
begin
  ---------------------------------------------------------------- preconditions
  select count(*) into v_candidates
  from players p
  where (p.parent_name is not null or p.parent_email is not null or p.parent_phone is not null)
    and not exists (select 1 from player_contacts c where c.player_id = p.id);

  -- Already applied. A second run is a no-op rather than a second insert.
  if v_candidates = 0 then
    raise notice 'C3b: no candidates remain; already applied. Nothing to do.';
    return;
  end if;

  -- FAIL CLOSED ON DRIFT. Twenty-five is the set that was audited and
  -- approved. Any other number means production moved and the set must be
  -- re-examined rather than guessed at.
  if v_candidates <> 25 then
    raise exception
      'C3b precondition failed: expected 25 legacy players to backfill, found %. Re-audit before applying.',
      v_candidates using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_non_player
  from players p
  where (p.parent_name is not null or p.parent_email is not null or p.parent_phone is not null)
    and not exists (select 1 from player_contacts c where c.player_id = p.id)
    and p.person_type <> 'player';
  if v_non_player <> 0 then
    raise exception 'C3b precondition failed: % non-player rows carry guardian data.', v_non_player
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_no_org
  from players p
  where (p.parent_name is not null or p.parent_email is not null or p.parent_phone is not null)
    and p.organization_id is null;
  if v_no_org <> 0 then
    raise exception 'C3b precondition failed: % candidates have no organization.', v_no_org
      using errcode = 'invalid_parameter_value';
  end if;

  --------------------------------------------------------------------- backfill
  -- is_primary is true because NOT EXISTS guarantees this is the player's only
  -- contact, so the partial unique index cannot be violated and no existing
  -- primary is displaced. sort_order is 0 for the same reason. created_by is
  -- NULL because no user performed this: a backfill is not an authorship, and
  -- attributing it to whoever ran the migration would be a small lie in the
  -- audit trail.
  insert into player_contacts (
    organization_id, player_id, full_name, relationship, email, phone,
    preferred_method, is_primary, sort_order, created_by
  )
  select
    p.organization_id,
    p.id,
    nullif(btrim(p.parent_name,  E' \t\r\n'), ''),
    null,
    nullif(btrim(p.parent_email, E' \t\r\n'), ''),
    nullif(btrim(p.parent_phone, E' \t\r\n'), ''),
    null,
    true,
    0,
    null
  from players p
  where (p.parent_name is not null or p.parent_email is not null or p.parent_phone is not null)
    and not exists (select 1 from player_contacts c where c.player_id = p.id);

  get diagnostics v_inserted = row_count;

  --------------------------------------------------------------- postconditions
  -- Any failure raises, and a DO block is one transaction, so the whole
  -- backfill rolls back rather than leaving a partial migration behind.
  if v_inserted <> 25 then
    raise exception 'C3b postcondition failed: inserted % rows, expected 25.', v_inserted
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) filter (where c.full_name is not null),
         count(*) filter (where c.full_name is null),
         count(*) filter (where c.email is not null),
         count(*) filter (where c.phone is not null)
    into v_named, v_nameless, v_email, v_phone
  from player_contacts c
  where c.created_by is null and c.sort_order = 0 and c.relationship is null;

  if v_named < 9 or v_nameless < 16 then
    raise exception 'C3b postcondition failed: name split was %/% , expected 9 named and 16 null.',
      v_named, v_nameless using errcode = 'invalid_parameter_value';
  end if;
  if v_email < 25 or v_phone < 23 then
    raise exception 'C3b postcondition failed: preserved %/% email/phone, expected 25 and 23.',
      v_email, v_phone using errcode = 'invalid_parameter_value';
  end if;

  -- Every value must equal its source exactly. This is the assertion that a
  -- name or relationship was not invented anywhere along the way.
  if exists (
    select 1 from player_contacts c join players p on p.id = c.player_id
    where c.created_by is null
      and (c.full_name    is distinct from nullif(btrim(p.parent_name,  E' \t\r\n'), '')
        or c.email        is distinct from nullif(btrim(p.parent_email, E' \t\r\n'), '')
        or c.phone        is distinct from nullif(btrim(p.parent_phone, E' \t\r\n'), '')
        or c.relationship is not null)
  ) then
    raise exception 'C3b postcondition failed: a backfilled contact does not match its source row.'
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (select 1 from player_contacts group by player_id having count(*) > 1) then
    raise exception 'C3b postcondition failed: a player has more than one contact.'
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (select 1 from player_contacts where is_primary group by player_id having count(*) > 1) then
    raise exception 'C3b postcondition failed: a player has more than one primary contact.'
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (
    select 1 from player_contacts c join players p on p.id = c.player_id
    where c.organization_id <> p.organization_id
  ) then
    raise exception 'C3b postcondition failed: a contact does not match its player''s organization.'
      using errcode = 'invalid_parameter_value';
  end if;

  raise notice 'C3b: backfilled % contacts (% named, % without a name).',
    v_inserted, v_named, v_nameless;
end $$;
