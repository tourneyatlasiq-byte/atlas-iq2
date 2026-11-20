"use client";
import { EventRoster } from "../../../components/EventRoster";
const P = (id, n) => ({ id: "pt-" + id, player_id: id, participation: "roster", jersey_number: null, positions: null, player: { id, full_name: n, person_type: "player" } });
export default function Page() {
  return (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <EventRoster tournament={{ id: "t1", name: "Fall Kickoff" }} participants={[P("p-ava", "Ava Lane")]} seasonRoster={[
        { id: "a1", player_id: "p-ava", is_active: true, player: { id: "p-ava", full_name: "Ava Lane", person_type: "player" } },
        { id: "a2", player_id: "p-bea", is_active: true, player: { id: "p-bea", full_name: "Bea Carter", person_type: "player" } },
      ]} pickupCandidates={[{ id: "p-pia", full_name: "Pia Pickup", grad_year: 2029, onSeasonRoster: false, eventsWithUs: 1 }]} canWrite seasonName="2026-27" playerDocuments={{}} />
    </div>
  );
}
