-- qab_04_pa_batting_order_snapshot
--
-- Preserves the batting-order position a player held at the moment each plate
-- appearance was recorded, so Performance can eventually analyse QAB by lineup
-- position even after a game's lineup is edited.
--
-- WHY A SNAPSHOT AND NOT A FOREIGN KEY
-- saveLineup() replaces a game's order with delete-then-insert, so every edit
-- destroys and recreates all game_lineup_slots rows. A foreign key would either
-- cascade-delete plate appearances on an ordinary lineup edit, or block lineup
-- edits once tracking has begun. A denormalised value is the correct shape:
-- the whole point is that it stops tracking the lineup.
--
-- WHY THE VALUE COMES FROM THE CLIENT
-- A trigger that reads the current lineup at insert time would be wrong
-- offline: a plate appearance tapped at 2pm and synchronised at 4pm, after the
-- order changed, would record the new position. The tracker already holds the
-- correct value at tap time and it travels in the queued payload.
--
-- SCOPE
-- Additive. QAB reasons, the is_qab generated column, PA numbering, the
-- natural-key index, idempotency, RLS and feature gating are untouched. No new
-- trigger: enforce_pa_attribution() already owns "fields immutable after
-- insert" and gains one line.

alter table public.plate_appearances
  add column batting_order smallint;

alter table public.plate_appearances
  add constraint pa_batting_order_range
  check (batting_order is null or batting_order between 1 and 40);

comment on column public.plate_appearances.batting_order is
  'Batting-order position held when this plate appearance was recorded. Historical snapshot, not a reference to game_lineup_slots. Null means unknown and must never be coalesced to zero in reporting.';

-- ---------------------------------------------------------------------------
-- Evidence-based backfill
-- ---------------------------------------------------------------------------
-- saveLineup() is delete-then-insert, so any edit resets created_at on every
-- slot for that game. A slot created BEFORE a plate appearance therefore proves
-- the order has not been rewritten since that plate appearance was recorded.
--
-- Rows without that proof stay null. Nothing is inferred.

update public.plate_appearances pa
   set batting_order = s.batting_order
  from public.game_lineup_slots s
 where s.game_id   = pa.game_id
   and s.player_id = pa.player_id
   and s.created_at < pa.created_at
   and pa.batting_order is null;

-- ---------------------------------------------------------------------------
-- Immutability, owned by the existing attribution trigger
-- ---------------------------------------------------------------------------
-- ORDER MATTERS. This runs AFTER the backfill on purpose.
--
-- The rule below restores batting_order from OLD on every update. During the
-- backfill OLD is null for every row, so installing this first would silently
-- revert the backfill and leave all twelve rows null with no error. Verified:
-- with the trigger replaced first, the backfill wrote 0 rows.
--
-- Running the backfill while the deployed qab_03 trigger is still in place —
-- which knows nothing about batting_order and passes it through — writes the
-- rows correctly. Both steps are in one migration, so the window does not
-- exist outside this transaction.
--
-- Body is otherwise identical to the deployed version apart from the single
-- new.batting_order line in the UPDATE branch.
-- ---------------------------------------------------------------------------
-- Body is identical to the deployed version apart from the single
-- new.batting_order line in the UPDATE branch.

create or replace function public.enforce_pa_attribution()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if TG_OP = 'INSERT' then
    if auth.uid() is not null then
      new.recorded_by := auth.uid();
    end if;

    if new.voided_at is null then
      new.voided_by := null;
    elsif auth.uid() is not null then
      new.voided_by := auth.uid();
    end if;

    return new;
  end if;

  -- Who created the plate appearance never changes.
  new.recorded_by := old.recorded_by;

  -- Nor does where they batted. Taken from OLD rather than validated, so a
  -- correction, void or restore cannot rewrite it and a caller does not have
  -- to echo it back.
  new.batting_order := old.batting_order;

  if old.voided_at is null and new.voided_at is not null then
    new.voided_by := coalesce(auth.uid(), new.voided_by);
  elsif new.voided_at is null then
    new.voided_by := null;
  else
    new.voided_by := old.voided_by;
  end if;

  return new;
end;
$$;

