"use client";

import Link from "next/link";
import {
  formatDateRange, formatDayLabel, formatClock, groupGamesByDate, locationParts,
} from "../../lib/schedule-rules";

/**
 * The parent Tournament Schedule.
 *
 * A season calendar first, a game schedule second. Tournament dates are the
 * reliable planning information — every tournament in production has them —
 * so they carry the visual weight. Game times exist for only a handful of
 * games, so they are an enhancement beneath each block rather than the spine
 * of the document.
 *
 * Renders only what the payload contains. It has no access to costs, notes,
 * contacts or results, because the query never fetched them. Each tournament
 * carries one status word, Committed or Considering, and nothing else about
 * the coach's decision.
 */

function fmtGenerated(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

export function TournamentScheduleReport({ report }) {
  const { organization, team, season, tournaments, warnings } = report;
  const generated = fmtGenerated(report.generatedAt);
  const hasTentative = tournaments.some((t) => t.status === "Considering");

  return (
    <div className="rpt-shell">
      {/* Screen only. Never printed. */}
      <div className="rpt-bar rpt-no-print">
        <div className="rpt-bar-head">
          <div>
            <p className="rpt-bar-title">Tournament schedule</p>
            <p className="rpt-bar-sub">
              Preview below. Print or save as PDF to share with families.
            </p>
          </div>
          <Link href="/reports" className="rpt-btn rpt-btn-secondary" style={{ textDecoration: "none" }}>
            ← Reports
          </Link>
        </div>

        {warnings.map((w, i) => (
          <div key={i} className="rpt-warn rpt-warn-note">
            {w.title && <strong>{w.title}. </strong>}
            {w.message}
          </div>
        ))}

        <div className="rpt-actions">
          <button type="button" className="rpt-btn rpt-btn-primary" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
      </div>

      <article className="rpt-page">
        <header className="rpt-head">
          <div className="rpt-head-row">
            <div className="rpt-head-identity">
              <p className="rpt-org">{team.name ?? organization.name}</p>
              {team.name && organization.name && team.name !== organization.name && (
                <p className="rpt-team">{organization.name}</p>
              )}
            </div>

            {organization.logoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="rpt-logo" src={organization.logoUrl} alt="" />
            )}
          </div>

          <h1 className="rpt-doc-title">{season.name} Tournament Schedule</h1>
          {generated && <p className="rpt-doc-meta">Prepared {generated}</p>}
        </header>

        {/* Only when something on the page is tentative. Every row carries its
            own label as well, so a single printed page is never ambiguous. */}
        {hasTentative && (
          <p className="sch-legend">
            <span className="sch-status sch-status-committed">Committed</span>
            <span className="sch-legend-text">The team plans to attend.</span>
            <span className="sch-status sch-status-considering">Considering</span>
            <span className="sch-legend-text">Tentative and subject to change. The team hasn&rsquo;t decided yet.</span>
          </p>
        )}

        {tournaments.length === 0 ? (
          <p className="sch-empty">
            No tournaments are on the schedule for this season yet.
          </p>
        ) : (
          <ol className="sch-list">
            {tournaments.map((t) => {
              const range = formatDateRange(t.startDate, t.endDate);
              const days = groupGamesByDate(t.games);
              const tentative = t.status === "Considering";

              return (
                <li key={t.id} className={tentative ? "sch-item sch-item-tentative" : "sch-item"}>
                  {/* Dates lead. They are the season-planning information a
                      family acts on, and the only field present on every
                      tournament in the product. The status sits beneath the
                      date, in the column's spare space, so no row grows. */}
                  <div className="sch-when">
                    <p className="sch-date">{range}</p>
                    <p className={`sch-status ${tentative ? "sch-status-considering" : "sch-status-committed"}`}>
                      {tentative ? "Considering" : "Committed"}
                    </p>
                  </div>

                  <div className="sch-body">
                  <h2 className="sch-name">{t.name}</h2>

                  {locationParts(t.place).length > 0 && (
                    <p className="sch-place">
                      {locationParts(t.place).map((part, i) => (
                        <span key={part.key}>
                          {i > 0 && <span className="sch-dot"> · </span>}
                          <span
                            className={
                              part.kind === "name"
                                ? "sch-place-name"
                                : part.kind === "address"
                                  ? "sch-address"
                                  : undefined
                            }
                          >
                            {part.text}
                          </span>
                        </span>
                      ))}
                    </p>
                  )}

                  {days.length === 0 ? (
                    /* Season Tempo knows only that nothing has been entered —
                       not whether the tournament has released a schedule. A
                       trailing status line, not another content row. Not shown
                       for a tentative tournament: "will be added" would imply
                       the team is going. */
                    !tentative && <p className="sch-pending">
                      Game times and opponents will be added when available.
                    </p>
                  ) : (
                    <div className="sch-games">
                      {days.map((d) => (
                        <div key={d.date} className="sch-day">
                          <p className="sch-day-label">{formatDayLabel(d.date)}</p>
                          <ul className="sch-day-games">
                            {d.games.map((g) => {
                              const time = formatClock(g.startTime);
                              return (
                                <li key={g.id}>
                                  {time && <span className="sch-time">{time}</span>}
                                  <span className="sch-opp">
                                    {g.opponent ? `vs ${g.opponent}` : "Opponent to be announced"}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <footer className="rpt-foot">
          Tournament dates and game times can change.
        </footer>
      </article>
    </div>
  );
}
