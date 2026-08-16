import "./report.css";
import Link from "next/link";
import { getContext } from "../../../lib/context";
import { createClient } from "../../../lib/supabase/server";
import { seasonBudgetReport } from "../../../lib/queries/reports/season-budget";
import { SeasonBudgetReport } from "../../../components/reports/SeasonBudgetReport";

export const dynamic = "force-dynamic";

/**
 * The document title IS the PDF filename.
 *
 * Browsers name a "Save as PDF" file from document.title, so this is the only
 * place the filename can be set — there is no separate download step to name.
 * The team is the subject of the document; Season Tempo is the software that
 * produced it, so it does not appear. Yields, for example:
 *
 *   Armor Elite Mower - Planned Season Budget - 2026-27.pdf
 *
 * Deliberately a light query of its own rather than the full report payload:
 * a title needs two names, and the report payload is an allowlist built for
 * the document body.
 */
export async function generateMetadata() {
  const fallback = { title: "Planned Season Budget" };

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
    // Characters a filesystem would strip or mangle.
    const safe = (v) => String(v ?? "").replace(/[\\/:*?"<>|]/g, "").trim();

    const parts = [safe(subject), "Planned Season Budget", safe(data.name)].filter(Boolean);
    return { title: parts.join(" - ") };
  } catch {
    // A title must never break the page.
    return fallback;
  }
}

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
