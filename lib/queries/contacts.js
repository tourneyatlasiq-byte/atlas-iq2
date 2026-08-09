import { createClient } from "../supabase/server";

/** The organization's address book, ordered for reading. */
export async function listContacts(organizationId) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, full_name, contact_category, title, organization_or_school, email, phone, notes")
    .eq("organization_id", organizationId)
    .order("full_name");

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Player links and college interests, keyed by player. */
export async function recruitingByPlayer(organizationId) {
  const supabase = createClient();

  const [{ data: links }, { data: interests }] = await Promise.all([
    supabase
      .from("player_links")
      .select("id, player_id, link_type, url, label")
      .eq("organization_id", organizationId)
      .order("created_at"),
    supabase
      .from("player_college_interests")
      .select("id, player_id, college_name, notes, contact_id")
      .eq("organization_id", organizationId)
      .order("college_name"),
  ]);

  const byPlayer = new Map();
  const bucket = (id) =>
    byPlayer.get(id) ?? byPlayer.set(id, { links: [], interests: [] }).get(id);

  for (const l of links ?? []) bucket(l.player_id).links.push(l);
  for (const i of interests ?? []) bucket(i.player_id).interests.push(i);

  return Object.fromEntries(byPlayer);
}
