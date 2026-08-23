-- Past seasons are locked for normal operations. Owner and admin may make
-- explicit corrections.
--
--   INSERT into a past season  -> blocked for everyone. Adding to a finished
--                                 season is rewriting what happened.
--   UPDATE a past-season row   -> owner/admin only. This is what a correction
--                                 actually is: a fact that was always true.
--   DELETE a past-season row   -> owner/admin only, with interface confirmation.
--
-- Current and future seasons are untouched: planning next year must stay
-- writable by anyone who can write at all.
--
-- One function serves every table. TG_ARGV[0] names the column holding the
-- season, or 'via_payment' for payment_log, which resolves through its parent.

create or replace function public.enforce_season_write_policy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  mode text := coalesce(TG_ARGV[0], 'season_id');
  new_season uuid;
  old_season uuid;
  new_phase text;
  old_phase text;
  is_admin boolean;
begin
  -- Resolve the season on each side of the change.
  if mode = 'via_payment' then
    if TG_OP <> 'DELETE' then
      select season_id into new_season from player_payments where id = NEW.payment_id;
    end if;
    if TG_OP <> 'INSERT' then
      select season_id into old_season from player_payments where id = OLD.payment_id;
    end if;
  else
    if TG_OP <> 'DELETE' then
      execute format('select ($1).%I', mode) into new_season using NEW;
    end if;
    if TG_OP <> 'INSERT' then
      execute format('select ($1).%I', mode) into old_season using OLD;
    end if;
  end if;

  new_phase := case when new_season is null then null else atlas_season_phase(new_season) end;
  old_phase := case when old_season is null then null else atlas_season_phase(old_season) end;

  -- Service-role and trigger-internal work has no auth.uid(); leave it alone.
  if auth.uid() is null then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  is_admin := auth_is_org_admin();

  if TG_OP = 'INSERT' then
    if new_phase = 'past' then
      raise exception 'That season has finished. New records can''t be added to it.'
        using errcode = 'check_violation';
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- Either side being past makes this a historical correction, which also
    -- stops a row being moved into or out of a past season to dodge the rules.
    if (old_phase = 'past' or new_phase = 'past') and not is_admin then
      raise exception 'Only an owner or admin can correct a finished season.'
        using errcode = 'insufficient_privilege';
    end if;

    if old_phase is distinct from new_phase
       and (old_phase = 'past' or new_phase = 'past') then
      raise exception 'A record can''t be moved into or out of a finished season.'
        using errcode = 'check_violation';
    end if;

    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    if old_phase = 'past' and not is_admin then
      raise exception 'Only an owner or admin can remove a record from a finished season.'
        using errcode = 'insufficient_privilege';
    end if;
    return OLD;
  end if;

  return NEW;
end;
$$;

comment on function public.enforce_season_write_policy() is
  'Past seasons: INSERT blocked for all; UPDATE and DELETE owner/admin only.
   Current and future seasons unaffected. TG_ARGV[0] names the season column,
   or ''via_payment'' to resolve through player_payments.';

-- Apply to every season-scoped table.
create trigger season_write_policy
  before insert or update or delete on games
  for each row execute function enforce_season_write_policy('season_id');

create trigger season_write_policy
  before insert or update or delete on budget_items
  for each row execute function enforce_season_write_policy('season_id');

create trigger season_write_policy
  before insert or update or delete on budget_transactions
  for each row execute function enforce_season_write_policy('season_id');

create trigger season_write_policy
  before insert or update or delete on player_payments
  for each row execute function enforce_season_write_policy('season_id');

create trigger season_write_policy
  before insert or update or delete on team_season_players
  for each row execute function enforce_season_write_policy('season_id');

-- payment_log has no season of its own; it belongs to the season of the
-- payment it records.
create trigger season_write_policy
  before insert or update or delete on payment_log
  for each row execute function enforce_season_write_policy('via_payment');

create trigger season_write_policy
  before insert or update or delete on tournament_participants
  for each row execute function enforce_season_write_policy('season_id');
