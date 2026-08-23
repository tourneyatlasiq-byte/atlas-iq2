-- RLS decides which rows you can see. It does not stop you referencing a
-- player or contact from another organization by UUID — the same gap the
-- participant trigger closes.

create or replace function enforce_player_child_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p_org uuid;
  c_org uuid;
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

  -- A linked contact must also be ours.
  if TG_TABLE_NAME = 'player_college_interests' and new.contact_id is not null then
    select organization_id into c_org from contacts where id = new.contact_id;
    if c_org is distinct from new.organization_id then
      raise exception 'That contact belongs to a different organization.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger player_links_org_check
  before insert or update on player_links
  for each row execute function enforce_player_child_org();

create trigger college_interests_org_check
  before insert or update on player_college_interests
  for each row execute function enforce_player_child_org();

-- Same protection for a tournament's contact.
create or replace function enforce_tournament_contact_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare c_org uuid;
begin
  if new.contact_id is null then return new; end if;

  select organization_id into c_org from contacts where id = new.contact_id;

  if c_org is distinct from new.organization_id then
    raise exception 'That contact belongs to a different organization.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger tournament_contact_org_check
  before insert or update of contact_id on tournaments
  for each row execute function enforce_tournament_contact_org();
