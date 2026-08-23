-- qab_03_authoritative_pa_attribution
--
-- Makes plate_appearances.recorded_by and voided_by authoritative from the
-- authenticated session rather than client-supplied.
--
-- WHY
-- enforce_pa_integrity() assigned attribution with
--   new.recorded_by := coalesce(new.recorded_by, auth.uid());
-- so a client-supplied value won. voided_by had no trigger at all. Verified
-- against production on 13 Aug 2026: impersonating one authenticated owner and
-- supplying a different real user's id in both columns stored the forged values
-- verbatim through PostgREST.
--
-- The table immediately alongside this one already does it correctly —
-- enforce_participant_integrity() assigns `new.added_by := auth.uid()`
-- unconditionally. This brings plate appearances to the same standard.
--
-- SCOPE
-- Attribution only. QAB reasons, the is_qab generated column, PA numbering,
-- the natural-key index, RLS policies, the feature gate, and all four
-- performance views are untouched. No non-QAB object is modified.

-- ---------------------------------------------------------------------------
-- 1. Attribution is owned by one trigger
-- ---------------------------------------------------------------------------

create function public.enforce_pa_attribution()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if TG_OP = 'INSERT' then
    -- auth.uid() is null for service-role and direct SQL (seeds, maintenance).
    -- Those paths keep whatever they supply, matching how
    -- enforce_season_write_policy() already treats a null caller. Through
    -- PostgREST an authenticated caller always has a uid, so the forging path
    -- is closed.
    if auth.uid() is not null then
      new.recorded_by := auth.uid();
    end if;

    -- A row cannot arrive already voided by someone else.
    if new.voided_at is null then
      new.voided_by := null;
    elsif auth.uid() is not null then
      new.voided_by := auth.uid();
    end if;

    return new;
  end if;

  -- UPDATE. Who created the plate appearance never changes, so a correction
  -- cannot rewrite it — deliberately taken from OLD rather than validated,
  -- which also means an unrelated edit preserves legitimate existing
  -- attribution without the caller having to echo it back.
  new.recorded_by := old.recorded_by;

  if old.voided_at is null and new.voided_at is not null then
    -- Active -> voided: this transition, and only this one, sets who voided it.
    new.voided_by := coalesce(auth.uid(), new.voided_by);
  elsif new.voided_at is null then
    -- Restored, or never voided. Void attribution must not outlive the void,
    -- or a restored row would name someone who did not void the current state.
    new.voided_by := null;
  else
    -- Already voided and staying voided. An unrelated update must not reassign.
    new.voided_by := old.voided_by;
  end if;

  return new;
end;
$$;

-- Name sorts before pa_integrity, so attribution is settled first. Both are
-- BEFORE triggers on the same table and Postgres fires same-timing triggers in
-- name order.
create trigger pa_attribution
  before insert or update on public.plate_appearances
  for each row execute function public.enforce_pa_attribution();

-- ---------------------------------------------------------------------------
-- 2. Remove the weak assignment from the integrity trigger
-- ---------------------------------------------------------------------------
-- Body is otherwise byte-identical to the deployed version. Only the trailing
-- `new.recorded_by := coalesce(...)` block is gone, so exactly one trigger owns
-- attribution and the two cannot drift.

create or replace function public.enforce_pa_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g_org uuid; g_season uuid; p_org uuid; p_type text;
begin
  select organization_id, season_id into g_org, g_season
    from games where id = new.game_id;

  if g_org is null then
    raise exception 'That game could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if new.season_id is distinct from g_season then
    raise exception 'The season does not match this game''s season.'
      using errcode = 'check_violation';
  end if;

  if new.organization_id is distinct from g_org then
    raise exception 'The organization does not match this game''s.'
      using errcode = 'check_violation';
  end if;

  select organization_id, person_type into p_org, p_type
    from players where id = new.player_id;

  if p_org is null then
    raise exception 'That player could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if p_org is distinct from g_org then
    raise exception 'That player belongs to a different organization.'
      using errcode = 'check_violation';
  end if;

  if p_type is distinct from 'player' then
    raise exception 'Only players can have plate appearances.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on column public.plate_appearances.recorded_by is
  'Set by enforce_pa_attribution() from auth.uid() on insert. Never client-supplied, never rewritten by a correction.';

comment on column public.plate_appearances.voided_by is
  'Set by enforce_pa_attribution() on the active->voided transition and cleared on restore. Never client-supplied.';
