create table documents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  player_id uuid references roster(id) on delete set null,
  category text not null check (category in ('Insurance', 'Birth Certificate', 'Receipt', 'Other')),
  file_name text not null,
  file_path text not null,          -- path inside the team-documents storage bucket
  notes text,
  uploaded_at timestamptz default now()
);

alter table documents enable row level security;

create policy "documents: team read" on documents
  for select using (team_id = auth_team_id());

create policy "documents: coach/manager write" on documents
  for all using (
    team_id = auth_team_id()
    and (select role from profiles where id = auth.uid()) in ('coach','manager')
  );
