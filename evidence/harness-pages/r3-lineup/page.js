"use client";
import { LineupClient } from "../../../components/LineupClient";
export default function Page() {
  const pl = [["p-ava", "Ava Lane"], ["p-bea", "Bea Carter"], ["p-ivy", "Ivy Grant"]].map(([id, n], i) => ({ player_id: id, full_name: n, jersey_number: i + 1, positions: "SS" }));
  return <div style={{ padding: 16 }}><LineupClient game={{ id: "g1", opponent_name: "Rays", game_date: "2026-11-07", tournament_id: "t1", status: "scheduled" }} initialLineup={[]} availablePlayers={pl} playerSource="roster" canWrite /></div>;
}
