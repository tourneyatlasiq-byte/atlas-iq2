-- Read: the organization's players, with the same parent restriction the
-- players table applies. Identical in shape to players and
-- player_college_interests — a contact must be no more visible than the
-- player it belongs to.
create policy "player_contacts: org read"
  on public.player_contacts
  for select
  using (
    organization_id = (select public.auth_organization_id())
    and (
      coalesce((select public.auth_org_role()), '') <> 'parent'
      or player_id in (select public.auth_linked_player_ids())
    )
  );

-- Write: owner, admin, coach and manager, within their own organization.
-- auth_can_write() already excludes parent, so a parent cannot write even for
-- a player they are linked to.
--
-- FOR ALL covers insert, update and delete: removing a guardian who is no
-- longer a contact is ordinary roster maintenance. This follows player_links
-- and player_college_interests. players itself has no delete policy, but that
-- is a deliberate exception protecting person records, not the pattern for a
-- child table.
create policy "player_contacts: org write"
  on public.player_contacts
  for all
  using (
    organization_id = (select public.auth_organization_id())
    and (select public.auth_can_write())
  )
  with check (
    organization_id = (select public.auth_organization_id())
    and (select public.auth_can_write())
  );
