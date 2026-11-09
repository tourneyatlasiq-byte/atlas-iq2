import "../season-budget/report.css";
import "./qab.css";
import Link from "next/link";
import { getContext } from "../../../lib/context";
import { createClient } from "../../../lib/supabase/server";
import { qabPerformanceReport } from "../../../lib/queries/reports/qab-performance";
import { QabPerformanceReport } from "../../../components/reports/QabPerformanceReport";
import { listTrackedTournaments, qabTournamentReport } from "../../../lib/queries/reports/qab-tournament";
import { QabTournamentReport } from "../../../components/reports/QabTournamentReport";
import { QabScopeControl } from "../../../components/reports/QabScopeControl";

export const dynamic = "force-dynamic";

/**
 * Report scope from the address (RPT-04). Season is the plain address;
 * ?scope=tournament&tournament=<id> is one tournament. Anything else is Season.
 */
function requestedScope(searchParams) {
  const isTournament = searchParams?.scope === "tournament";
  const id = typeof searchParams?.tournament === "string" ? searchParams.tournament : null;
  return { isTournament, tournamentId: isTournament ? id : null };
}

/**
 * The document title IS the PDF filename.
 *
 *   Northgate 16U Gold - QAB Performance - 2026-27.pdf
 *   Armor Elite Mower - QAB Performance - TC Veterans Tribute.pdf
 */
export async function generateMetadata({ searchParams } = {}) {
  const fallback = { title: "QAB Performance" };

  try {
    const { season, features } = await getContext();
    // A non-entitled organization is not told the team's name in a title.
    if (!season || !features?.qab) return fallback;

    const supabase = createClient();
    const { data } = await supabase
      .from("seasons")
      .select("name, team:teams ( name, organization:organizations ( name ) )")
      .eq("id", season.id)
      .maybeSingle();

    if (!data) return fallback;

    const subject = data.team?.name ?? data.team?.organization?.name ?? null;
    const safe = (v) => String(v ?? "").replace(/[\\/:*?"<>|]/g, "").trim();

    // Tournament scope names the tournament instead of the season. The same
    // season check as the report itself: a foreign id names nothing.
    let scopeName = data.name;
    const { isTournament, tournamentId } = requestedScope(searchParams);
    if (isTournament) {
      const tracked = tournamentId ? null : (await listTrackedTournaments(season.id))[0];
      const id = tournamentId ?? tracked?.id ?? null;
      if (id) {
        const { data: t } = await supabase
          .from("tournaments")
          .select("name")
          .eq("id", id)
          .eq("season_id", season.id)
          .maybeSingle();
        if (t?.name) scopeName = t.name;
      }
    }

    const parts = [safe(subject), "QAB Performance", safe(scopeName)].filter(Boolean);
    return { title: parts.join(" - ") };
  } catch {
    return fallback;
  }
}

/**
 * Coach-facing QAB Performance report.
 *
 * ENTITLEMENT, TWICE OVER, using the existing model — no second system.
 *
 * 1. This page checks features.qab and refuses before running any query, so a
 *    non-entitled organization navigating straight to the URL gets a locked
 *    page rather than an empty document.
 * 2. The database is the boundary that actually matters. Every policy on
 *    plate_appearances and game_lineup_slots begins with
 *    auth_org_has_feature('qab') on SELECT and on ALL, so even if this check
 *    were removed the underlying query would read zero rows for a Basic
 *    organization. The UI check exists to say so honestly, not to enforce it.
 */
export default async function QabPerformancePage({ searchParams } = {}) {
  const { season, features } = await getContext();

  if (!features?.qab) {
    return (
      <div className="rpt-shell">
        <div className="rpt-blocked">
          <h2>QAB Performance is a Premium feature</h2>
          <p className="rpt-blocked-lead">
            Quality At-Bat tracking and reporting aren&rsquo;t enabled for this organization.
          </p>
          <p><Link href="/reports">← Back to Reports</Link></p>
        </div>
      </div>
    );
  }

  if (!season) {
    return (
      <div className="rpt-shell">
        <div className="rpt-blocked">
          <h2>No season selected</h2>
          <p>This team needs a season before performance can be reported.</p>
          <p><Link href="/reports">← Back to Reports</Link></p>
        </div>
      </div>
    );
  }

  // Offered in the screen-only scope control. With none tracked, Season shows
  // no control at all.
  const tournaments = await listTrackedTournaments(season.id);
  const { isTournament, tournamentId: requestedId } = requestedScope(searchParams);

  if (isTournament) {
    const tournamentId = requestedId ?? tournaments[0]?.id ?? null;
    const report = tournamentId ? await qabTournamentReport(season.id, tournamentId) : null;

    if (!report) {
      return (
        <div className="rpt-shell">
          <div className="rpt-blocked">
            <h2>Tournament not found</h2>
            <p>That tournament isn&rsquo;t part of this season&rsquo;s QAB tracking.</p>
            <p><Link href="/reports/qab-performance">← Season QAB Performance</Link></p>
          </div>
        </div>
      );
    }

    // A linked tournament reached by address keeps its place in the selector
    // even before it has tracked at-bats.
    const options = tournaments.some((t) => t.id === tournamentId)
      ? tournaments
      : [{ id: tournamentId, name: report.tournament.name, dates: report.tournament.dates }, ...tournaments];

    return (
      <QabTournamentReport
        report={report}
        scopeControl={<QabScopeControl tournaments={options} selectedId={tournamentId} />}
      />
    );
  }

  const report = await qabPerformanceReport(season.id);

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

  return (
    <QabPerformanceReport
      report={report}
      scopeControl={<QabScopeControl tournaments={tournaments} selectedId={null} />}
    />
  );
}
