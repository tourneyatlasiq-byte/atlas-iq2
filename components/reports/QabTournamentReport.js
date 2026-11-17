"use client";

import { ReportToolbar } from "./ReportToolbar";
import { formatQabPct, formatScoreline, legacyReasonNote } from "../../lib/qab-rules";
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
 * TOURNAMENT SUMMARY (2026-11) replaces the old Team QAB and reason sections.
 * Two scopes, kept apart: every QAB figure covers tracked games only; the
 * record and runs cover every tournament game with a result. When some result
 * games have no QAB tracking, one plain line says so (it prints, because it
 * says what the numbers cover). Nothing here ranks, grades or judges a player,
 * and nothing compares the two tournaments beyond showing both.
 *
 * Players are listed alphabetically by the payload; no cell is emphasised.
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
// A grey dash for "did not bat". No cell with a QAB is emphasised: nothing here
// promotes one player's or one game's cell over another.
const cellClass = (c) => (c == null ? "qab-gbg-none" : "");

const EN = "\u2013";
// Reason mix segment colours, in legend order. The legend (label, count, share)
// carries every reading; colour only repeats it.
const MIX_COLORS = ["#0b2341", "#2f80ed", "#8fb8f5", "#1b8a8f", "#475569", "#a9bfd6", "#7fc8c4", "#8a5a00"];

const recordText = (r) => `${r.w}${EN}${r.l}${r.t > 0 ? `${EN}${r.t}` : ""}`;

function resultLine(g) {
  const word = g.result ? RESULT_WORD[g.result] ?? g.result : null;
  const score = formatScoreline(g.runsFor, g.runsAgainst);
  return [word, score].filter(Boolean).join(" ");
}

function GameHighlight({ label, g }) {
  if (!g) return null;
  const res = resultLine(g);
  return (
    <div className="rpt-card wide">
      <p className="rpt-h">{label}</p>
      <p className="qab-ts-fig">{pct(g.qabPct)}</p>
      <p className="qab-ts-hl">
        <strong>G{g.number}</strong>{g.opponent ? ` vs ${g.opponent}` : ""}
        <br />
        {`${g.qab} / ${g.pa} QAB / PA${res ? ` \u00b7 ${res}` : ""}`}
      </p>
    </div>
  );
}

export function QabTournamentReport({ report, scopeControl = null }) {
  const { organization, team, season, tournament, summary, games, reasons, reasonsCited, players, notes } = report;
  const ts = report.tournamentSummary ?? {};
  // A long name stacks above its figure on a phone (see qab.css); short names stay on one line.
  const cmpRowClass = (label) => `qab-ts-cmp-row${label.length > 38 ? " long" : ""}`;
  const generated = fmtGenerated(report.generatedAt);
  const tracked = summary.pa > 0;
  // As in Season: no game with a result in scope, no Result column.
  const showResult = games.some((g) => Boolean(g.result));
  const mixTotal = Math.max(1, reasons.reduce((n, r) => n + r.count, 0));
  const scope = ts.scope ?? { untrackedResultGames: 0 };
  const denominator = summary.games + (scope.untrackedResultGames ?? 0);
  const trackedText = scope.untrackedResultGames > 0 ? `${summary.games} of ${denominator}` : `${summary.games}`;
  const tiles = [ts.record, ts.runs, ts.days].filter(Boolean).length;
  const tileCols = tiles === 3 ? "" : tiles === 2 ? " two" : " one";

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
            <section className="rpt-section qab-tsum">
              <p className="rpt-h">Tournament summary</p>
              <div className={`qab-ts-top${ts.previous ? "" : " solo"}`}>
                <div className="qab-ts-main">
                  <p className="qab-hero">{pct(summary.qabPct)}</p>
                  <ul className="qab-facts">
                    <li><strong>{summary.qab}</strong> QAB / <strong>{summary.pa}</strong> PA</li>
                    <li><strong>{trackedText}</strong> {denominator === 1 ? "game" : "games"} tracked</li>
                  </ul>
                </div>
                {ts.previous && (
                  <div className="qab-ts-cmp">
                    <div className={cmpRowClass(tournament.name)}>
                      <span className="qab-ts-cmp-name">{tournament.name}</span>
                      <span className="qab-ts-cmp-val"><strong>{pct(summary.qabPct)}</strong> <span>{`(${summary.qab}/${summary.pa})`}</span></span>
                    </div>
                    <div className={cmpRowClass(`Previous tournament, ${ts.previous.name}`)}>
                      <span className="qab-ts-cmp-name">{`Previous tournament, ${ts.previous.name}`}</span>
                      <span className="qab-ts-cmp-val"><strong>{pct(ts.previous.qabPct)}</strong> <span>{`(${ts.previous.qab}/${ts.previous.pa})`}</span></span>
                    </div>
                  </div>
                )}
              </div>

              {tiles > 0 && (
                <div className={`qab-ts-grid${tileCols}`}>
                  {ts.record && (
                    <div className="rpt-card">
                      <p className="rpt-h">Record</p>
                      <p className="qab-ts-fig">{recordText(ts.record)}</p>
                      <p className="qab-ts-sub">{ts.record.t > 0 ? "Wins, losses, ties" : "Wins, losses"}</p>
                    </div>
                  )}
                  {ts.runs && (
                    <div className="rpt-card">
                      <p className="rpt-h">Runs scored / allowed</p>
                      <div className="qab-ts-runs">
                        <div><p className="qab-ts-fig">{ts.runs.scored}</p><p className="qab-ts-sub">Scored</p></div>
                        <div><p className="qab-ts-fig">{ts.runs.allowed}</p><p className="qab-ts-sub">Allowed</p></div>
                      </div>
                    </div>
                  )}
                  {ts.days && (
                    <div className="rpt-card wide">
                      <p className="rpt-h">QAB% by day</p>
                      <ul className="qab-ts-days">
                        {ts.days.map((d) => (
                          <li key={d.date}>
                            <span className="d">{d.label}</span>
                            <span className="n">{`${d.qab}/${d.pa}`}</span>
                            <span className="p">{pct(d.qabPct)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {scope.untrackedResultGames > 0 && (
                <p className="qab-ts-scope">
                  {`Record and runs include all ${scope.resultGames} games with results. QAB figures use only the ${summary.games} ${summary.games === 1 ? "game" : "games"} with QAB tracking.`}
                </p>
              )}

              {(ts.highest || ts.lowest) && (
                <div className="qab-ts-grid two">
                  <GameHighlight label="Highest QAB% game" g={games[(ts.highest ?? 0) - 1]} />
                  <GameHighlight label="Lowest QAB% game" g={games[(ts.lowest ?? 0) - 1]} />
                </div>
              )}

              {reasons.length > 0 && (
                <div className="qab-ts-mix">
                  <p className="rpt-h">QAB reason mix</p>
                  <p className="qab-note">
                    Each quality at-bat is counted once, under the one primary reason the coach
                    recorded. Shares are of {summary.qab} quality at-bats.
                  </p>
                  <div className="qab-mix-bar" role="img" aria-label="QAB reason mix">
                    {reasons.map((r, i) => (
                      <span key={r.label} className="qab-mix-seg" style={{ width: `${(r.count / mixTotal) * 100}%`, background: MIX_COLORS[i % MIX_COLORS.length] }} />
                    ))}
                  </div>
                  <ul className="qab-mix-legend">
                    {reasons.map((r, i) => (
                      <li key={r.label}>
                        <span className="qab-mix-sw" style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />
                        <span>{r.label}</span>
                        <span className="qab-mix-n">{r.count}</span>
                        <span className="qab-mix-p">{pct(r.percent)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
                              <>
                                <span className={`qab-res qab-res-${g.result.toLowerCase()}`}>
                                  {RESULT_WORD[g.result] ?? g.result}
                                </span>
                                {formatScoreline(g.runsFor, g.runsAgainst) && (
                                  <span className="qab-score">{formatScoreline(g.runsFor, g.runsAgainst)}</span>
                                )}
                              </>
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
                    <th className="qab-num qab-c-qg">
                      <span className="qab-th-long">Games with a QAB</span>
                      <span className="qab-th-short">QAB games</span>
                    </th>
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
                        <li key={games[i].id} className={cellClass(c) || undefined}>
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
          share of plate appearances. Games with a QAB counts the games in which a player recorded at
          least one quality at-bat, out of the games in which the player batted.
        </footer>
      </article>
    </div>
  );
}
