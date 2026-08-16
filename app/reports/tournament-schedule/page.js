import "../season-budget/report.css";
import "./schedule.css";
import Link from "next/link";
import { getContext } from "../../../lib/context";
import { createClient } from "../../../lib/supabase/server";
import { tournamentScheduleReport } from "../../../lib/queries/reports/tournament-schedule";
import { TournamentScheduleReport } from "../../../components/reports/TournamentScheduleReport";

export const dynamic = "force-dynamic";

/**
 * The document title IS the PDF filename. Same convention as the Planned
 * Season Budget: the team is the subject, Season Tempo is the software.
 *
 *   Armor Elite Mower - Tournament Schedule - 2026-27.pdf
 */
export async function generateMetadata() {
  const fallback = { title: "Tournament Schedule" };

  try {
    const { season } = await getContext();
    if (!season) return fallback;

    const supabase = createClient();
    const { data } = await supabase
      .from("seasons")
      .select("name, team:teams ( name, organization:organizations ( name ) )")
      .eq("id", season.id)
      .maybeSingle();

    if (!data) return fallback;

    const subject = data.team?.name ?? data.team?.organization?.name ?? null;
    const safe = (v) => String(v ?? "").replace(/[\\/:*?"<>|]/g, "").trim();
    const parts = [safe(subject), "Tournament Schedule", safe(data.name)].filter(Boolean);
    return { title: parts.join(" - ") };
  } catch {
    return fallback;
  }
}

/**
 * Parent-facing Tournament Schedule.
 *
 * Its own route with no application chrome — a document, not a screen, printed
 * to PDF by the browser. Scope is resolved here at the page boundary and passed
 * to the query explicitly; the payload it returns is an allowlist, so no cost,
 * note, contact or result can be printed by accident.
 */
export default async function TournamentSchedulePage() {
  const { season } = await getContext();

  if (!season) {
    return (
      <div className="rpt-shell">
        <div className="rpt-blocked">
          <h2>No season selected</h2>
          <p>This team needs a season before a schedule can be created.</p>
          <p><Link href="/reports">← Back to Reports</Link></p>
        </div>
      </div>
    );
  }

  const report = await tournamentScheduleReport(season.id);

  if (!report) {
    return (
      <div className="rpt-shell">
        <div className="rpt-blocked">
          <h2>Season not found</h2>
          <p><Link href="/reports">← Back to Reports</Link></p>
        </div>
      </div>
    );
  }

  return <TournamentScheduleReport report={report} />;
}
