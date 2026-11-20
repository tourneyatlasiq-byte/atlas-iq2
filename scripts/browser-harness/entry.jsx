import React from "react";
import { createRoot } from "react-dom/client";
import { TrackerClient } from "../../components/TrackerClient.js";

const NAMES = ["Ava Lane", "Bea Ortiz", "Cleo Park", "Dana Reyes", "Eli Marsh", "Fay Dunn", "Gia Webb", "Hana Cole", "Ivy Stone"];
const lineup = NAMES.map((full_name, i) => ({ player_id: `p0${i + 1}`, full_name, jersey_number: 10 + i, participation: "roster", batting_order: i + 1, archived: false }));
const game = { id: "g1", tournament_id: "t1", season_id: "s1", game_date: "2026-11-21", start_time: "09:00:00", opponent_name: "Fictional Heat 16U", result: null, runs_for: null, runs_against: null, qab_completed_at: null, tournament: { id: "t1", name: "Fictional Classic" } };
const seedRows = (window.__seed ?? []).map((r) => ({ ...r, localSeq: new Date(r.created_at).getTime(), player: { id: r.player_id, full_name: NAMES[Number(r.player_id.slice(2)) - 1] } }));
window.__srv = window.__srv || { rows: [], calls: [] };
window.__srv.rows.push(...seedRows.map(({ localSeq, player, ...r }) => r));
createRoot(document.getElementById("root")).render(
  <TrackerClient game={game} lineup={lineup} substitutes={[]} initialRows={seedRows} canWrite={true} userId="u1" serverToday="2026-11-21" tournamentGames={[{ id: "g1", game_date: "2026-11-21", start_time: "09:00:00", opponent_name: "Fictional Heat 16U", result: null, batters: 9, plateAppearances: seedRows.length, qabCompleted: false }]} />
);
