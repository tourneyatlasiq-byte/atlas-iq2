-- ============================================================
-- INVITES — lets a coach invite a co-coach, manager, or
-- read-only parent to their existing team, instead of every
-- new sign-up creating a brand new team.
-- ============================================================
create table invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  email text not null,
  role text not null check (role in ('coach', 'manager', 'parent')),
  created_at timestamptz default now()
);

alter table invites enable row level security;

-- A brand-new user (no profile yet) can see invites addressed to their
-- own email, so the login callback can find and accept them.
create policy "invites: visible to invited email" on invites
  for select using (email = auth.email());

-- Coaches/managers can see and manage invites for their own team
create policy "invites: team coach/manager manage" on invites
  for all using (
    team_id = auth_team_id()
    and (select role from profiles where id = auth.uid()) in ('coach','manager')
  );

-- A newly-invited user needs to be able to remove their own invite
-- once accepted (handled server-side in the auth callback)
create policy "invites: invited user can delete own" on invites
  for delete using (email = auth.email());

-- ============================================================
-- BUDGET TRANSACTIONS — replaces flat budget line items with a
-- real transaction ledger. Category summary cards are computed
-- from these rows, not entered by hand.
-- ============================================================
create table budget_transactions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  tournament_id uuid references tournaments(id) on delete set null,
  category text not null,
  txn_date date default current_date,
  vendor text,
  item text not null,
  quantity numeric default 1,
  budgeted_amount numeric(10,2) default 0,
  actual_amount numeric(10,2) default 0,
  status text not null default 'Planned' check (status in ('Planned', 'Ordered', 'Received', 'Paid')),
  receipt_path text,
  notes text,
  created_at timestamptz default now()
);

alter table budget_transactions enable row level security;

create policy "budget_transactions: team read" on budget_transactions
  for select using (team_id = auth_team_id());

create policy "budget_transactions: coach/manager write" on budget_transactions
  for all using (
    team_id = auth_team_id()
    and (select role from profiles where id = auth.uid()) in ('coach','manager')
  );
