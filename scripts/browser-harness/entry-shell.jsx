import React from "react";
import { createRoot } from "react-dom/client";
import { TrackerClient } from "../../components/TrackerClient.js";
import { NavSidebar } from "../../components/NavSidebar.js";
import { AppFooter } from "../../components/AppFooter.js";
import { ViewportVars } from "../../components/ViewportVars.js";
import { VoltScope } from "../../components/VoltScope.js";
import { HelpContextProvider } from "../../components/HelpContext.js";

// Same real shell as the app: NavSidebar (sticky phone header, fixed bottom bar), .shell/.main/.content, AppFooter.
const NAMES = ["Ava Lane", "Bea Ortiz", "Cleo Park", "Hannah Cole", "Eli Marsh", "Fay Dunn", "Gia Webb", "Harper Cole", "Ivy Stone"];
const lineup = NAMES.map((full_name, i) => ({ player_id: `p0${i + 1}`, full_name, jersey_number: 10 + i, participation: "roster", batting_order: i + 1, archived: false }));
const game = { id: "g1", tournament_id: "t1", season_id: "s1", game_date: "2026-11-21", start_time: "09:00:00", opponent_name: "Fictional Heat 16U", result: null, runs_for: null, runs_against: null, qab_completed_at: null, tournament: { id: "t1", name: "Fictional Classic" } };
// A page load models a server render: sessionStorage.__srvRows (written by a test) stands for what the database holds at that
// moment; without it the baked seed is the database. sessionStorage.__off=1 keeps the "connection" down across a reload.
const baked = (() => { try { return JSON.parse(sessionStorage.getItem("__srvRows") || "null"); } catch { return null; } })();
window.__offline = (() => { try { return sessionStorage.getItem("__off") === "1"; } catch { return false; } })();
const seedRows = (baked ?? window.__seed ?? []).map((r) => ({ ...r, localSeq: new Date(r.created_at).getTime(), player: { id: r.player_id, full_name: NAMES[Number(r.player_id.slice(2)) - 1] } }));
window.__srv = window.__srv || { rows: [], calls: [] };
window.__srv.rows.push(...seedRows.map(({ localSeq, player, ...r }) => r));
const season = { id: "s1", name: "2026-27" };
const toInitial = (rows) => rows.map((r) => ({ ...r, localSeq: new Date(r.created_at ?? 0).getTime(), player: { id: r.player_id, full_name: NAMES[Number(r.player_id.slice(2)) - 1] } }));
const App = ({ initialRows }) => (
  <div className="shell">
    <VoltScope /><ViewportVars />
    <NavSidebar email="coach@example.com" organization={{ id: "o1", name: "Fictional Fastpitch" }} team={{ id: "tm1", name: "Fictional 16U" }} season={season} seasons={[season]} seasonPhase="current" features={{ qab: true }} />
    <div className="main"><main className="content">
      <HelpContextProvider qab={true} isAdmin={true} canWrite={true} phase="current">
        <div className="page">
          <div className="page-head"><a className="back-link" href="/lineup">← Lineup</a></div>
          <TrackerClient game={game} lineup={lineup} substitutes={[]} initialRows={initialRows} canWrite={window.__canWrite !== false} userId="u1" serverToday="2026-11-21" tournamentGames={[{ id: "g1", game_date: "2026-11-21", start_time: "09:00:00", opponent_name: "Fictional Heat 16U", result: null, batters: 9, plateAppearances: initialRows.length, qabCompleted: false }]} />
        </div>
      </HelpContextProvider>
      <AppFooter />
    </main></div>
  </div>
);
// Returning to the tracker: window.__remount("stale") renders it again from the page's first snapshot (what a cached or earlier
// server render holds); "fresh" renders it from what the stand-in database holds now. Offline queue and connection are untouched.
const root = createRoot(document.getElementById("root"));
let generation = 0;
const first = seedRows;
const show = (rows) => root.render(<App key={++generation} initialRows={rows} />);
window.__remount = (kind) => show(kind === "fresh" ? toInitial(window.__srv.rows) : first);
show(first);
