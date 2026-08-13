import { getContext, canWrite } from "../../../lib/context";
import { listContacts } from "../../../lib/queries/contacts";
import { createClient } from "../../../lib/supabase/server";
import { ContactsClient } from "../../../components/ContactsClient";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { profile, organization, season } = await getContext();

  const supabase = createClient();

  // The two relationships that exist today. Nothing speculative: facilities
  // have no contact_id, and player_college_interests carries one but is empty.
  const [contacts, tournamentsRes, interestsRes] = await Promise.all([
    listContacts(organization.id),
    supabase
      .from("tournaments")
      .select("id, name, start_date, contact_id")
      .eq("season_id", season?.id ?? "")
      .not("contact_id", "is", null),
    supabase
      .from("player_college_interests")
      .select("id, college_name, contact_id, player:players ( id, full_name )")
      .eq("organization_id", organization.id)
      .not("contact_id", "is", null),
  ]);

  const usedBy = {};
  for (const t of tournamentsRes.data ?? []) {
    (usedBy[t.contact_id] ??= []).push({
      kind: "tournament",
      id: t.id,
      label: t.name,
      href: `/tournaments?open=${t.id}`,
    });
  }
  for (const i of interestsRes.data ?? []) {
    (usedBy[i.contact_id] ??= []).push({
      kind: "college",
      id: i.id,
      label: `${i.college_name} — ${i.player?.full_name ?? "a player"}`,
      href: "/team",
    });
  }

  return (
    <ContactsClient
      contacts={contacts}
      usedBy={usedBy}
      canWrite={canWrite(profile)}
    />
  );
}
