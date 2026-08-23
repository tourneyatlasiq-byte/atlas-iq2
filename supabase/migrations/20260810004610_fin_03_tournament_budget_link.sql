-- Links a tournament to the budget line its costs belong to.
--
-- Deliberately explicit rather than inferred from the category name. Three
-- organizations already use "Tournament Fees", "Tournaments" and
-- "Fees & Team Building" for the same thing, so text matching would be wrong
-- for two of them.
--
-- Nullable: a tournament with no linked line simply does not participate in
-- budget commitment, which is honest rather than guessed.

alter table tournaments
  add column budget_item_id uuid references budget_items(id) on delete set null;

create index idx_tournaments_budget_item on tournaments (budget_item_id);

comment on column tournaments.budget_item_id is
  'The budget line this tournament''s costs count against. Only Committed
   tournaments consume budget; Considering and Declined are excluded.';

-- The linked line must belong to the same season and be an expense, or the
-- category totals could never reconcile.
create or replace function enforce_tournament_budget_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare b record;
begin
  if new.budget_item_id is null then return new; end if;

  select season_id, is_income, organization_id into b
    from budget_items where id = new.budget_item_id;

  if b is null then
    raise exception 'That budget line could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if b.organization_id is distinct from new.organization_id then
    raise exception 'That budget line belongs to a different organization.'
      using errcode = 'check_violation';
  end if;

  if b.season_id is distinct from new.season_id then
    raise exception 'That budget line belongs to a different season.'
      using errcode = 'check_violation';
  end if;

  if b.is_income then
    raise exception 'Tournament costs belong to an expense budget line, not an income line.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger tournament_budget_link_check
  before insert or update of budget_item_id on tournaments
  for each row execute function enforce_tournament_budget_link();
