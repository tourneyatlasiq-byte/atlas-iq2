-- Change which of a player's contacts is primary, atomically.
--
-- SECURITY INVOKER, like intake_apply and roster_add_member. The caller
-- already holds update rights on their organization's player_contacts, so
-- DEFINER would buy nothing and would move the guard out of RLS into this
-- function.
--
-- WHY THIS EXISTS. player_contacts_one_primary is a PLAIN partial unique
-- index, checked per row rather than deferred to commit. Promoting before
-- demoting can therefore transiently leave two primaries and fail on row
-- order alone. The server action did the two updates as two separate
-- PostgREST calls, so a failure between them left the player with no explicit
-- primary at all. C3a's deterministic rule made that degrade to a display
-- default rather than a broken record, but "usually recovers" is not the same
-- as correct. A function body is one transaction: either the primary moves or
-- nothing does.
--
-- DEMOTE THEN PROMOTE, in that order. Between the two statements the player
-- has zero primaries, which the partial index permits; the reverse order
-- would transiently have two, which it does not. The index remains the
-- database-level final safeguard and is deliberately unchanged.
--
-- NOTHING ELSE IS TOUCHED. No contact detail field, no players.parent_*, no
-- row belonging to another player. updated_at moves because the row genuinely
-- changed, and leaving it stale would misreport when the record last changed.
create or replace function public.set_primary_contact(
  p_player_id  uuid,
  p_contact_id uuid
)
returns json
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_user       uuid := auth.uid();
  v_org        uuid := public.auth_organization_id();
  v_target_org uuid;
  v_already    boolean;
  v_demoted    int;
  v_promoted   int;
begin
  ------------------------------------------------------------------ identity
  if v_user is null then
    raise exception 'You must be signed in to change a contact.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'Your account is not attached to an organization.'
      using errcode = 'insufficient_privilege';
  end if;

  -- auth_can_write() excludes the parent role. RLS enforces this too; the
  -- explicit check exists so a refusal reads as a sentence rather than as a
  -- silent zero-row update.
  if not public.auth_can_write() then
    raise exception 'Your role does not allow changes to contacts.'
      using errcode = 'insufficient_privilege';
  end if;

  ------------------------------------------------- target exists and belongs
  -- Read under RLS. Both conditions matter: a contact id from another player
  -- must not be promotable onto this one, and a contact from another
  -- organization is invisible here anyway.
  select c.organization_id, c.is_primary
    into v_target_org, v_already
  from player_contacts c
  where c.id = p_contact_id and c.player_id = p_player_id;

  if not found then
    raise exception 'That contact does not belong to this player.'
      using errcode = 'no_data_found';
  end if;

  if v_target_org is distinct from v_org then
    raise exception 'That contact belongs to a different organization.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Already primary: nothing to do. Idempotent rather than an error, so a
  -- double click or a retried request cannot churn the row.
  if v_already then
    return json_build_object(
      'changed', false, 'contact_id', p_contact_id, 'demoted', 0
    );
  end if;

  --------------------------------------------------------- demote, then promote
  update player_contacts
     set is_primary = false, updated_at = now()
   where player_id = p_player_id and is_primary;
  get diagnostics v_demoted = row_count;

  update player_contacts
     set is_primary = true, updated_at = now()
   where id = p_contact_id and player_id = p_player_id;
  get diagnostics v_promoted = row_count;

  -- If the promotion did not land — an RLS refusal, a row that vanished — the
  -- exception rolls back the demotion with it and the previous primary
  -- survives untouched. This is the case the two-call version could not
  -- recover from.
  if v_promoted <> 1 then
    raise exception 'That contact could not be made primary.'
      using errcode = 'no_data_found';
  end if;

  return json_build_object(
    'changed', true, 'contact_id', p_contact_id, 'demoted', v_demoted
  );
end;
$$;

revoke all on function public.set_primary_contact(uuid, uuid) from public, anon;
grant execute on function public.set_primary_contact(uuid, uuid) to authenticated;

comment on function public.set_primary_contact is
  'Moves a player''s primary contact atomically. SECURITY INVOKER so RLS remains authoritative. Demotes before promoting so the partial unique index is never transiently violated. Touches no contact detail field and no players.parent_* column.';
