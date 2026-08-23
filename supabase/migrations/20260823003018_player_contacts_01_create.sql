-- Contact information for a player. Storage only.
--
-- SEPARATE FROM ACCESS BY DESIGN. player_guardians means an authenticated
-- user may see a player; this table means a person is worth contacting.
-- There is deliberately no profile_id: writing a row here must never grant
-- application access, and a contact becomes a guardian only through an
-- explicit invitation.
create table public.player_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  player_id        uuid not null references public.players(id) on delete cascade,

  -- Nullable on purpose. 16 existing records carry a parent email or phone
  -- with no name, and "name unknown" is a real state worth keeping distinct
  -- from an invented one. The interface supplies a display label; the
  -- database does not invent data.
  full_name        text,

  relationship     text,
  email            text,
  phone            text,
  is_primary       boolean not null default false,
  preferred_method text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id) on delete set null,

  constraint player_contacts_preferred_method_check
    check (preferred_method is null
           or preferred_method = any (array['text','email','call'])),

  -- At least one meaningful attribute. A name alone is legitimate: knowing
  -- who a player's guardian is has value before their details are collected.
  --
  -- btrim() is given an explicit character set because its default strips
  -- SPACES ONLY — a tab or newline would otherwise pass as a real value.
  constraint player_contacts_has_detail
    check (
         coalesce(btrim(full_name,    E' \t\r\n'), '') <> ''
      or coalesce(btrim(relationship, E' \t\r\n'), '') <> ''
      or coalesce(btrim(email,        E' \t\r\n'), '') <> ''
      or coalesce(btrim(phone,        E' \t\r\n'), '') <> ''
    )
);

comment on table public.player_contacts is
  'Contact information for a player. Storage only: a row here grants no application access. Access is player_guardians, which requires a profile.';

comment on column public.player_contacts.full_name is
  'Null means the name was never collected, not that the contact is anonymous. Never populated with a placeholder.';

-- One primary per player. Partial, so any number of non-primary contacts
-- coexist.
create unique index player_contacts_one_primary
  on public.player_contacts (player_id)
  where is_primary;

create index idx_player_contacts_player on public.player_contacts (player_id);
create index idx_player_contacts_org    on public.player_contacts (organization_id);

-- players.organization_id is nullable, so the foreign key alone cannot
-- guarantee the contact and the player belong to the same tenant. This is the
-- same trigger player_links uses.
create trigger player_contacts_org_check
  before insert or update on public.player_contacts
  for each row execute function public.enforce_player_child_org();

-- Enabled with no policies: the table is unreachable by any client until B3
-- adds them. Deliberate — a window where the table exists and is readable is
-- exactly the window we do not want.
alter table public.player_contacts enable row level security;
