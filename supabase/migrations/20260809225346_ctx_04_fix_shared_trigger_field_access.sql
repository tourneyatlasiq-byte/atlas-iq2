-- PL/pgSQL resolves NEW.<field> at parse time for the row type in hand, so a
-- single guarded expression referencing new.contact_id fails on player_links,
-- which has no such column — even though the table check is false.
--
-- Split into two functions rather than one shared with a table check. The
-- shared version looked tidier and could not work.

create or replace function enforce_player_child_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare p_org uuid;
begin
  select organization_id into p_org from players where id = new.player_id;

  if p_org is null then
    raise exception 'That player could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if p_org is distinct from new.organization_id then
    raise exception 'That player belongs to a different organization.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function enforce_college_interest_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare p_org uuid; c_org uuid;
begin
  select organization_id into p_org from players where id = new.player_id;

  if p_org is null then
    raise exception 'That player could not be found.'
      using errcode = 'foreign_key_violation';
  end if;

  if p_org is distinct from new.organization_id then
    raise exception 'That player belongs to a different organization.'
      using errcode = 'check_violation';
  end if;

  if new.contact_id is not null then
    select organization_id into c_org from contacts where id = new.contact_id;
    if c_org is distinct from new.organization_id then
      raise exception 'That contact belongs to a different organization.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists college_interests_org_check on player_college_interests;

create trigger college_interests_org_check
  before insert or update on player_college_interests
  for each row execute function enforce_college_interest_org();
