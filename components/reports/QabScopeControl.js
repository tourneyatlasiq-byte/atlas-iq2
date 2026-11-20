"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { withFrom } from "../../lib/report-back";

export const QAB_REPORT_PATH = "/reports/qab-performance";

/** The address of a scope. Season is the report's plain address. Keeps the screen the report was opened from. */
export function qabScopeHref(tournamentId, from = null, base = null) {
  // The individual player report is the same control over its own address,
  // with its player kept in the query. Plain strings, so it crosses from the
  // server page to this client component.
  const path = base?.path ?? QAB_REPORT_PATH;
  const lead = base?.player ? `${path}?player=${encodeURIComponent(base.player)}` : path;
  const join = lead.includes("?") ? "&" : "?";
  return withFrom(
    tournamentId ? `${lead}${join}scope=tournament&tournament=${encodeURIComponent(tournamentId)}` : lead,
    from
  );
}

/**
 * Screen-only scope control for QAB Performance (RPT-04):
 *
 *   Report scope  [ Season ] [ Tournament ]
 *   Tournament    [ TC Veterans Tribute · Nov 7–8, 2026 ▾ ]
 *
 * Lives in the shared toolbar, so it never prints. Each choice is an address
 * (?scope=tournament&tournament=<id>) and the server builds that scope's
 * report, so a refresh, a bookmark or Back shows the same document. Only
 * tournaments with tracked plate appearances are offered.
 */
export function QabScopeControl({ tournaments = [], selectedId = null, from = null, base = null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (tournaments.length === 0) return null;

  const isTournament = Boolean(selectedId);
  const go = (href) => startTransition(() => router.push(href, { scroll: false }));
  const href = (id) => qabScopeHref(id, from, base);

  return (
    <div className="rpt-detail qab-scope" aria-busy={pending || undefined}>
      <div className="qab-scope-row" role="group" aria-label="Report scope">
        <span className="rpt-detail-label">Report scope</span>
        <span className="rpt-seg">
          <button
            type="button"
            className={`rpt-seg-btn${!isTournament ? " on" : ""}`}
            aria-pressed={!isTournament}
            onClick={() => isTournament && go(href(null))}
          >
            Season
          </button>
          <button
            type="button"
            className={`rpt-seg-btn${isTournament ? " on" : ""}`}
            aria-pressed={isTournament}
            onClick={() => !isTournament && go(href(tournaments[0].id))}
          >
            Tournament
          </button>
        </span>
      </div>
      {isTournament && (
        <label className="qab-scope-row">
          <span className="rpt-detail-label">Tournament</span>
          <select
            className="qab-scope-select"
            value={selectedId}
            onChange={(e) => go(href(e.target.value))}
          >
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.dates ? `${t.name} · ${t.dates}` : t.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
