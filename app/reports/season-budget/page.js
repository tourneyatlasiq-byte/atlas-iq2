import "./report.css";
import Link from "next/link";
import { getContext } from "../../../lib/context";
import { seasonBudgetReport } from "../../../lib/queries/reports/season-budget";
import { SeasonBudgetReport } from "../../../components/reports/SeasonBudgetReport";

export const dynamic = "force-dynamic";

export const metadata = { title: "Planned Season Budget — Season Tempo" };

/**
 * Parent-facing Season Budget report.
 *
 * A dedicated route with its own stylesheet and no application chrome — no
 * sidebar, no tabs, no navigation. It is a document, not a screen, and it is
 * printed to PDF by the browser rather than captured from the Finance page.
 *
 * Scope is resolved here, at the page boundary, and the query is given an
 * explicit seasonId. The payload it returns is an allowlist: no player, no
 * transaction and no internal note is fetched into it, so none can be printed
 * by accident.
 *
 * /reports is not in the middleware's public list, so an unauthenticated
 * request is redirected to /login before reaching this handler. RLS scopes the
 * underlying reads to the caller's organization.
 */
export default async function SeasonBudgetReportPage() {
  const { season, features } = await getContext();

  if (!season) {
    return (
      <div className="rpt-shell">
        <div className="rpt-blocked">
          <h2>No season selected</h2>
          <p>This team needs a season before a budget report can be created.</p>
          <p><Link href="/finance">← Back to Finance</Link></p>
        </div>
      </div>
    );
  }

  const report = await seasonBudgetReport(season.id, { variant: "planned" });

  if (!report) {
    return (
      <div className="rpt-shell">
        <div className="rpt-blocked">
          <h2>Season not found</h2>
          <p><Link href="/finance">← Back to Finance</Link></p>
        </div>
      </div>
    );
  }

  // features is read only so the report can stay consistent with the rest of
  // the product later; the budget report itself is not premium-gated.
  void features;

  return <SeasonBudgetReport report={report} />;
}
