"use client";

import { ReportToolbar } from "./ReportToolbar";
import { formatQabPct, legacyReasonNote } from "../../lib/qab-rules";
import { formatClock } from "../../lib/schedule-rules";

/**
 * Coach-facing Tournament QAB Performance (RPT-04).
 *
 * The Season report's visual language — same shell, toolbar, header, section
 * headings, tables and reason bars — over one tournament's linked games.
 * Season itself is a separate component and is not changed by this one.
 *
 * COACH-FACING, by decision (2026-11): it shows each player's game-by-game
 * QAB/PA. That is not a precedent for any parent-facing report.
 *
 * Game by Game prints as a matrix. On a phone screen the matrix is replaced
 * by one card per player whose game tiles wrap rather than clip; print always
 * uses the matrix.
 */

const pct = formatQabPct;
const RESULT_WORD = { W: "Win", L: "Loss", T: "Tie" };

function fmtGenerated(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const cell = (c) => (c ? `${c.qab}/${c.pa}` : "–");
const cellClass = (c) => (c == null ? "qab-gbg-none" : c.qab > 0 ? "qab-gbg-q" : "");

export function QabTournamentReport({ report, scopeControl = null }) {
  const { organization, team, season, tournament, summary, games, reasons, reasonsCited, players, notes } = report;
  const generated = fmtGenerated(report.generatedAt);
  const tracked = summary.pa > 0;
  // As in Season: no game with a result in scope, no Result column.
  const showResult = games.some((g) => Boolean(g.result));
  const maxReason = Math.max(1, ...reasons.map((r) => r.count));

  return (
    <div className="rpt-shell">
      {/* Screen only. Never printed. */}
      <ReportToolbar
        name="QAB Performance"
        controls={scopeControl}
        notes={[...(notes ?? []), ...legacyReasonNote(reasonsCited, summary.qab)]}
      />

      <article className="rpt-page qab-tournament">
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

          <h1 className="rpt-doc-title">{tournament.name}</h1>
          <p className="rpt-doc-meta">
            QAB Performance
            {tournament.dates && ` · ${tournament.dates}`}
            {season.name && ` · ${season.name} season`}
            {generated && ` · Updated ${generated}`}
          </p>
        </header>

        {!tracked ? (
          <p className="qab-none">No quality at-bats have been tracked for this tournament yet.</p>
        ) : (
          <>
            <section className="rpt-section qab-summary">
              <p className="rpt-h">Team QAB</p>
              <div className="qab-summary-row">
                <p className="qab-hero">{pct(summary.qabPct)}</p>
                <ul className="qab-facts">
                  <li><strong>{summary.qab}</strong> QAB / <strong>{summary.pa}</strong> PA</li>
                  <li><strong>{summary.games}</strong> {summary.games === 1 ? "game" : "games"} tracked</li>
                </ul>
              </div>
            </section>

            <section className="rpt-section">
              <p className="rpt-h">QAB% by game</p>
              <table className="qab-table qab-t-games">
                <thead>
                  <tr>
                    <th className="qab-c-gn">#</th>
                    <th className="qab-c-date">Date / time</th>
                    <th>Opponent</th>
                    {showResult && <th className="qab-c-res">Result</th>}
                    <th className="qab-num">QAB / PA</th>
                    <th className="qab-num">QAB%</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => {
                    const time = formatClock(g.time);
                    return (
                      <tr key={g.id}>
                        <td className="qab-c-gn">G{g.number}</td>
                        <td className="qab-c-date">
                          {/* On phones the game number moves above the date. */}
                          <span className="qab-gn-inline">G{g.number}</span>
                          {g.day ?? "—"}
                          {time && <span className="qab-time"><span className="qab-time-sep"> · </span>{time}</span>}
                        </td>
                        <td>{g.opponent ?? "—"}</td>
                        {showResult && (
                          <td className="qab-c-res">
                            {g.result ? (
                              <span className={`qab-res qab-res-${g.result.toLowerCase()}`}>
                                {RESULT_WORD[g.result] ?? g.result}
                              </span>
                            ) : (
                              ""
                            )}
                          </td>
                        )}
                        <td className="qab-num">{g.qab} / {g.pa}</td>
                        <td className="qab-num qab-strong">{pct(g.qabPct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {reasons.length > 0 && (
              <section className="rpt-section">
                <p className="rpt-h">What created quality at-bats</p>
                <p className="qab-note">
                  Each quality at-bat is counted once, under the one primary reason the coach
                  recorded. Shares are of {summary.qab} quality at-bats.
                </p>
                <ul className="qab-reasons">
                  {reasons.map((r) => (
                    <li key={r.label}>
                      <span className="qab-reason-label">{r.label}</span>
                      <span className="qab-reason-bar" aria-hidden="true">
                        <span style={{ width: `${(r.count / maxReason) * 100}%` }} />
                      </span>
                      <span className="qab-reason-count">{r.count}</span>
                      <span className="qab-reason-pct">{pct(r.percent)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rpt-section">
              <p className="rpt-h">Player tournament totals</p>
              <table className="qab-table qab-players">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="qab-num qab-c-g">G</th>
                    <th className="qab-num">QAB</th>
                    <th className="qab-num">PA</th>
                    <th className="qab-num">QAB%</th>
                    <th className="qab-num qab-c-qg">QAB games</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td className="qab-num qab-c-g">{p.games}</td>
                      <td className="qab-num">{p.qab}</td>
                      <td className="qab-num">{p.pa}</td>
                      <td className="qab-num qab-strong">{pct(p.qabPct)}</td>
                      <td className="qab-num qab-c-qg">{p.qabGames} of {p.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rpt-section qab-gbg">
              <p className="rpt-h">Game by game</p>
              <p className="qab-note">
                QAB / PA in each game, numbered as in QAB% by game. A dash means the player did not bat.
              </p>

              {/* Desktop and print. */}
              <div className="qab-gbg-matrix">
                <table className="qab-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      {games.map((g) => <th key={g.id} className="qab-num">G{g.number}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        {p.byGame.map((c, i) => (
                          <td key={games[i].id} className={`qab-num ${cellClass(c)}`.trim()}>{cell(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phone screens only: one card per player; tiles wrap, never clip. */}
              <ul className="qab-gbg-cards">
                {players.map((p) => (
                  <li key={p.name} className="qab-gbg-card">
                    <p className="qab-gbg-head">
                      <span className="qab-gbg-name">{p.name}</span>
                      <span className="qab-gbg-total">{p.qab}/{p.pa}</span>
                    </p>
                    <ol className="qab-gbg-tiles">
                      {p.byGame.map((c, i) => (
                        <li key={games[i].id} className={cellClass(c)}>
                          <span className="qab-gbg-g">G{games[i].number}</span>
                          <span className="qab-gbg-v">{cell(c)}</span>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <footer className="rpt-foot">
          A quality at-bat is recorded by the coach during the game. QAB% is quality at-bats as a
          share of plate appearances. QAB games counts the games in which a player recorded at least
          one quality at-bat, out of the games in which the player batted.
        </footer>
      </article>
    </div>
  );
}
