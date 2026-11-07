"use client";

import { useState } from "react";
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
 * the coach's decision — plus, for a Committed tournament only, whether it is
 * waitlisted, because "Committed" alone would read as a secured spot.
 */

function fmtGenerated(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

const isTentative = (t) => t.status === "Considering";
const isWaitlisted = (t) => !isTentative(t) && Boolean(t.waitlisted);
const itemClass = (t) => (isTentative(t) ? "sch-item sch-item-tentative" : "sch-item");

/** Dates lead, with the status beneath them in the column's spare space. */
function TournamentWhen({ t }) {
  const tentative = isTentative(t);
  const waitlisted = isWaitlisted(t);
  return (
    <div className="sch-when">
      <p className="sch-date">{formatDateRange(t.startDate, t.endDate)}</p>
      <p className={`sch-status ${tentative ? "sch-status-considering" : waitlisted ? "sch-status-waitlisted" : "sch-status-committed"}`}>
        {tentative ? "Considering" : waitlisted ? <>Committed &bull; Waitlisted</> : "Committed"}
      </p>
    </div>
  );
}

/**
 * Name, place and — only when the coach chose "Include game schedule" and the
 * tournament has games entered — its games, grouped by day. A tournament with
 * no games looks the same in both versions: no empty section.
 */
function TournamentBody({ t, showGames }) {
  const days = showGames ? groupGamesByDate(t.games) : [];
  const renderDay = (d) => (
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
                {g.gameType && <span className="sch-gtype"> · {g.gameType}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
  // Print pagination: the heading and the first game day form one unbreakable
  // block (.sch-keep); later days may start a new page, but never split.
  return (
    <div className="sch-body">
      <div className="sch-keep">
      <div className="sch-heading">
        <h2 className="sch-name">{t.name}</h2>
        {locationParts(t.place).length > 0 && (
          <p className="sch-place">
            {locationParts(t.place).map((part, i) => (
              <span key={part.key}>
                {i > 0 && <span className="sch-dot"> · </span>}
                <span
                  className={
                    part.kind === "name" ? "sch-place-name" : part.kind === "address" ? "sch-address" : undefined
                  }
                >
                  {part.text}
                </span>
              </span>
            ))}
          </p>
        )}
      </div>

      {days.length > 0 && <div className="sch-games sch-games-first">{renderDay(days[0])}</div>}
      </div>
      {days.length > 1 && <div className="sch-games sch-games-more">{days.slice(1).map(renderDay)}</div>}
    </div>
  );
}

/** The two report detail levels. Display only: both use the same records. */
export const SCHEDULE_DETAIL = { tournaments: "tournaments", games: "games" };

export function TournamentScheduleReport({ report, initialDetail = SCHEDULE_DETAIL.tournaments }) {
  const { organization, team, season, tournaments, warnings } = report;
  const generated = fmtGenerated(report.generatedAt);
  const hasTentative = tournaments.some((t) => t.status === "Considering");
  const hasWaitlisted = tournaments.some((t) => t.status === "Committed" && t.waitlisted);
  /**
   * One general note instead of a line under every tournament (2026-11).
   * Shown only while a tournament the team is attending — Committed and not
   * waitlisted — has no games entered yet. Considering and waitlisted
   * tournaments don't trigger it: "will be added" would imply the team has a
   * place. Season Tempo knows only that nothing has been entered, not whether
   * the tournament has released a schedule.
   */
  const [detail, setDetail] = useState(
    initialDetail === SCHEDULE_DETAIL.games ? SCHEDULE_DETAIL.games : SCHEDULE_DETAIL.tournaments
  );
  const showGames = detail === SCHEDULE_DETAIL.games;
  // In Tournaments only no game is printed, so "game times will be added" would
  // be noise; the note applies only when games are shown.
  const gamesPending = showGames && tournaments.some(
    (t) => t.status === "Committed" && !t.waitlisted && (t.games ?? []).length === 0
  );

  /**
   * The choice lives only in this page's address (?detail=games), so a refresh
   * keeps it. Nothing is saved to the team, the user or any record.
   */
  function choose(next) {
    setDetail(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === SCHEDULE_DETAIL.games) url.searchParams.set("detail", "games");
      else url.searchParams.delete("detail");
      window.history.replaceState(null, "", url);
    }
  }

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

        <div className="rpt-detail" role="group" aria-label="Report detail">
          <span className="rpt-detail-label">Report detail</span>
          <span className="rpt-seg">
            {[
              [SCHEDULE_DETAIL.tournaments, "Tournaments only"],
              [SCHEDULE_DETAIL.games, "Include game schedule"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rpt-seg-btn${detail === key ? " on" : ""}`}
                aria-pressed={detail === key}
                onClick={() => choose(key)}
              >
                {label}
              </button>
            ))}
          </span>
        </div>

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
          {generated && <p className="rpt-doc-meta">Updated {generated}</p>}
        </header>

        {tournaments.length === 0 ? (
          <p className="sch-empty">
            No tournaments are on the schedule for this season yet.
          </p>
        ) : !showGames ? (
          /* Tournaments only (the default): one block per tournament, never
             split across pages. No game is printed. */
          <ol className="sch-list">
            {tournaments.map((t) => (
              <li key={t.id} className={itemClass(t)}>
                <TournamentWhen t={t} />
                <TournamentBody t={t} showGames={false} />
              </li>
            ))}
          </ol>
        ) : (
          /* Include game schedule: the same tournaments, in a table so the slim
             column-label row repeats at the top of every printed page. Games
             sit indented beneath their own tournament, never as rows of their
             own. A tournament may continue onto the next page only between
             game days; its heading always travels with its first day. */
          <table className="sch-table">
            <thead>
              <tr className="sch-colhead">
                <th scope="col">Dates</th>
                <th scope="col">Tournament &amp; Games</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id} className={`${itemClass(t)} sch-row`}>
                  <td className="sch-cell-when"><TournamentWhen t={t} /></td>
                  <td className="sch-cell-body"><TournamentBody t={t} showGames /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Legend and footer travel together: one block that never splits
            across pages, so the closing lines are never stranded. */}
        <div className="sch-end">
          {/* Schedule status legend (2026-11: moved here from the top, so the
              schedule starts right after the header). Only when something is
              tentative or waitlisted, and each explanation only for a label
              that actually appears. Every row carries its own label as well, so
              a single printed page is never ambiguous. Kept in one piece and
              with the footer when it paginates. */}
          {(hasTentative || hasWaitlisted) && (
            <section className="sch-legend" aria-label="Schedule status">
              <p className="sch-legend-label">Schedule status</p>
              <div className="sch-legend-items">
                <span className="sch-legend-item">
                  <span className="sch-status sch-status-committed">Committed</span>
                  <span className="sch-legend-text">The team plans to attend.</span>
                </span>
                {hasTentative && (
                  <span className="sch-legend-item">
                    <span className="sch-status sch-status-considering">Considering</span>
                    <span className="sch-legend-text">Tentative and subject to change. The team hasn&rsquo;t decided yet.</span>
                  </span>
                )}
                {hasWaitlisted && (
                  <span className="sch-legend-item">
                    <span className="sch-status sch-status-waitlisted">Committed &bull; Waitlisted</span>
                    <span className="sch-legend-text">The team is committed to attending if a spot becomes available.</span>
                  </span>
                )}
              </div>
            </section>
          )}

          <footer className="rpt-foot">
            {gamesPending && (
              <span className="sch-foot-line">
                Game times and opponents will be added as schedules become available.
              </span>
            )}
            <span className="sch-foot-line">Tournament dates and game times can change.</span>
          </footer>
        </div>
      </article>
    </div>
  );
}
