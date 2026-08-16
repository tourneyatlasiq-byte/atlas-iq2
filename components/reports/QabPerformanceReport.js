"use client";

import Link from "next/link";

/**
 * Coach-facing Team/Season QAB Performance report.
 *
 * Renders only what the payload contains. It has no access to per-player game
 * history, plate appearances, lineups or scores, because the query never
 * fetched them — and no player row carries an id, so this document cannot be
 * narrowed to one player and handed to a parent.
 *
 * There is deliberately no wins-versus-losses figure anywhere. Result appears
 * beside a game as factual context and nowhere else.
 */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Plain YYYY-MM-DD as a LOCAL date, so a game never prints a day early. */
function shortDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${MONTHS[m - 1]} ${d}`;
}

function fmtGenerated(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

const pct = (v) => (v == null ? "—" : `${v}%`);

const RESULT_WORD = { W: "Win", L: "Loss", T: "Tie" };

export function QabPerformanceReport({ report }) {
  const { organization, team, season, summary, games, reasons, reasonsCited, players } = report;
  const generated = fmtGenerated(report.generatedAt);
  const tracked = summary.pa > 0;

  // Bars are scaled to the largest reason, so the shape is readable even when
  // no single reason dominates.
  const maxReason = Math.max(1, ...reasons.map((r) => r.count));

  return (
    <div className="rpt-shell">
      {/* Screen only. Never printed. */}
      <div className="rpt-bar rpt-no-print">
        <div className="rpt-bar-head">
          <div>
            <p className="rpt-bar-title">QAB performance</p>
            <p className="rpt-bar-sub">Preview below. Print or save as PDF.</p>
          </div>
          <Link href="/reports" className="rpt-btn rpt-btn-secondary" style={{ textDecoration: "none" }}>
            ← Reports
          </Link>
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

          <h1 className="rpt-doc-title">{season.name} QAB Performance</h1>
          {generated && <p className="rpt-doc-meta">Prepared {generated}</p>}
        </header>

        {!tracked ? (
          /* No zeros manufactured — zeros would imply tracking happened and
             produced nothing. */
          <p className="qab-none">
            No quality at-bats have been tracked for this season yet.
          </p>
        ) : (
          <>
            <section className="rpt-section qab-summary">
              <p className="rpt-h">Team QAB</p>
              <div className="qab-summary-row">
                <p className="qab-hero">{pct(summary.qabPct)}</p>
                <ul className="qab-facts">
                  <li><strong>{summary.qab}</strong> QAB / <strong>{summary.pa}</strong> PA</li>
                  <li><strong>{summary.games}</strong> {summary.games === 1 ? "game" : "games"} tracked</li>
                  <li><strong>{summary.players}</strong> {summary.players === 1 ? "player" : "players"} tracked</li>
                </ul>
              </div>
            </section>

            <section className="rpt-section">
              <p className="rpt-h">QAB% by game</p>
              <table className="qab-table">
                <thead>
                  <tr>
                    <th className="qab-c-date">Date</th>
                    <th>Opponent</th>
                    <th className="qab-c-res">Result</th>
                    <th className="qab-num">QAB / PA</th>
                    <th className="qab-num">QAB%</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.id}>
                      <td className="qab-c-date">{shortDate(g.date) ?? "—"}</td>
                      <td>{g.opponent ?? "—"}</td>
                      {/* Context only. A game without a recorded result simply
                          shows nothing. */}
                      <td className="qab-c-res">
                        {g.result ? (
                          <span className={`qab-res qab-res-${g.result.toLowerCase()}`}>
                            {RESULT_WORD[g.result] ?? g.result}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="qab-num">{g.qab} / {g.pa}</td>
                      <td className="qab-num qab-strong">{pct(g.qabPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {reasons.length > 0 && (
              <section className="rpt-section">
                <p className="rpt-h">How QABs were earned</p>
                <p className="qab-note">
                  {reasonsCited} reasons cited across {summary.qab} quality at-bats. One at-bat can
                  cite more than one reason.
                </p>
                <ul className="qab-reasons">
                  {reasons.map((r) => (
                    <li key={r.label}>
                      <span className="qab-reason-label">{r.label}</span>
                      <span className="qab-reason-bar" aria-hidden="true">
                        <span style={{ width: `${(r.count / maxReason) * 100}%` }} />
                      </span>
                      {/* Count and share are printed, so the bar is a second
                          reading of the value and never the only one. */}
                      <span className="qab-reason-count">{r.count}</span>
                      <span className="qab-reason-pct">{pct(r.percent)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rpt-section">
              <p className="rpt-h">Player QAB summary</p>
              <table className="qab-table qab-players">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="qab-num">QAB</th>
                    <th className="qab-num">PA</th>
                    <th className="qab-num">QAB%</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    /* Every tracked player, at the percentage actually
                       recorded. No threshold, no suppression, no split — PA
                       sits beside it so the coach reads sample size herself. */
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td className="qab-num">{p.qab}</td>
                      <td className="qab-num">{p.pa}</td>
                      <td className="qab-num qab-strong">{pct(p.qabPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        <footer className="rpt-foot">
          A quality at-bat is recorded by the coach during the game. QAB% is quality at-bats as a
          share of plate appearances.
        </footer>
      </article>
    </div>
  );
}
