import "../season-budget/report.css";
import "./qab.css";
import Link from "next/link";
import { getContext } from "../../../lib/context";
import { createClient } from "../../../lib/supabase/server";
import { qabPerformanceReport } from "../../../lib/queries/reports/qab-performance";
import { QabPerformanceReport } from "../../../components/reports/QabPerformanceReport";

export const dynamic = "force-dynamic";

/**
 * The document title IS the PDF filename.
 *
 *   Northgate 16U Gold - QAB Performance - 2026-27.pdf
 */
export async function generateMetadata() {
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
    const parts = [safe(subject), "QAB Performance", safe(data.name)].filter(Boolean);
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
export default async function QabPerformancePage() {
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

  return <QabPerformanceReport report={report} />;
}
