"use client";
import { Suspense } from "react";
import { TournamentClient } from "../../../components/TournamentClient";
const T = { id: "t1", name: "Fall Kickoff", start_date: "2026-11-07", end_date: "2026-11-09", entry_fee: 400, decision: "Committed", payment_status: "unpaid", location: "Peach Park", city: "Macon", state: "GA", provider: null, provider_id: null, facility_id: null, notes: null, games: [], documents: [] };
export default function Page() {
  return (
    <Suspense>
      <TournamentClient tournaments={[T]} actions={[]} summary={{ total: 1 }} record={{}} providers={[]} facilities={[]} canWrite isAdmin documentTargets={[]} seasonName="2026-27" participants={{}} seasonRoster={[]} pickupCandidates={[]} playerDocuments={{}} contacts={[]} budgetLines={[]} arrivalNotes={{}} season={{ id: "s1", name: "2026-27" }} transactions={[]} serverToday="2026-11-20" />
    </Suspense>
  );
}
