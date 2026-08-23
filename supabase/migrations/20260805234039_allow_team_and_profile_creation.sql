-- Any logged-in user can create a new team (this is how a new coach starts)
create policy "teams: authenticated can create" on teams
  for insert with check (auth.uid() is not null);

-- A user can only ever create/update their own profile row
create policy "profiles: user can create own" on profiles
  for insert with check (id = auth.uid());

create policy "profiles: user can update own" on profiles
  for update using (id = auth.uid());
