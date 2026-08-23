alter table teams
  add column if not exists logo_url text,
  add column if not exists facebook_url text,
  add column if not exists instagram_url text,
  add column if not exists x_url text;

alter table roster
  add column if not exists position text,
  add column if not exists person_type text default 'Player' check (person_type in ('Player', 'Coach', 'Other')),
  add column if not exists other_role_label text;  -- e.g. "Team Mom", "Social Media" -- only used when person_type = 'Other'

-- Allow coaches/managers to update their own team's row (name, logo, socials)
create policy "teams: coach/manager update own" on teams
  for update using (
    id = auth_team_id()
    and (select role from profiles where id = auth.uid()) in ('coach','manager')
  );
