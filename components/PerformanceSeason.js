"use client";

import { useMemo, useState } from "react";

/**
 * Season performance.
 *
 * Presentation only. Every number arrives already aggregated from
 * getSeasonPerformance(); this component never sees a raw plate appearance and
 * never computes a quality at-bat. Its state is Team/Players and whether the
 * full reason vocabulary is expanded.
 *
 * The design principle throughout: a coach can see everything they recorded
 * from the first at-bat. The protection against over-reading a small sample is
 * in presentation — counts carry more weight than percentages, nothing is
 * ranked, and no direction is claimed — not in hiding their data.
 */
function fmtDate(d) {
  if (!d) return null;
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

/**
 * Where through this lineup did the quality at-bats come from?
 *
 * Ordered by batting position, never by percentage — the sequence is the
 * report. Positions come from the immutable plate_appearances.batting_order
 * snapshot, so this stays accurate for a game whose lineup was later edited.
 *
 * Descriptive only. A high figure in one slot mostly reflects who the coach
 * put there, so nothing here suggests that a position causes performance.
 */
function LineupContribution({ game }) {
  const maxPa = Math.max(1, ...game.lineup.map((s) => s.pa));

  return (
    <div className="lc">
      {/* Context restated inside the expansion because a twelve-position
          lineup scrolls the collapsed row off screen. Every value is read
          from the aggregate already passed in — no new query or maths. */}
      <p className="lc-context">
        <span className="lc-context-opp">{game.opponent}</span>
        <span aria-hidden="true"> · </span>
        <span>
          {game.qab} QAB / {game.pa} PA
        </span>
        {game.qabPct != null && (
          <>
            <span aria-hidden="true"> · </span>
            <span>{game.qabPct}%</span>
          </>
        )}
        <span aria-hidden="true"> · </span>
        <span>
          {game.lineup.length} {game.lineup.length === 1 ? "batter" : "batters"}
        </span>
      </p>

      <p className="lc-title">Lineup contribution</p>
      <p className="lc-sub">QAB performance through the batting order</p>

      <ul className="lc-list">
        {game.lineup.map((s) => (
          <li key={`${s.battingOrder ?? "x"}-${s.playerId}`}>
            <span className="lc-slot">{s.battingOrder ?? "—"}</span>
            <span className="lc-name">{s.name}</span>
            <span className="lc-bar" aria-hidden="true">
              {/* Width tracks plate appearances, fill tracks quality at-bats,
                  so a 1/1 cannot visually outweigh a 3/5. */}
              <span className="lc-bar-pa" style={{ width: `${(s.pa / maxPa) * 100}%` }}>
                <span
                  className="lc-bar-qab"
                  style={{ width: `${s.pa ? (s.qab / s.pa) * 100 : 0}%` }}
                />
              </span>
            </span>
            <span className="lc-figs">
              {s.qab}/{s.pa}
            </span>
            <span className="lc-pct">{s.qabPct == null ? "—" : `${s.qabPct}%`}</span>
          </li>
        ))}
      </ul>

      {game.lineup.some((s) => s.battingOrder == null) && (
        <p className="lc-note">— means the batting position was not recorded.</p>
      )}
    </div>
  );
}

export function PerformanceSeason({ team, reasons, reasonsCited, players, games, gamesCompleted, record }) {
  const [view, setView] = useState("team");
  const [allReasons, setAllReasons] = useState(false);
  const [openGame, setOpenGame] = useState(null);
  const [openPlayer, setOpenPlayer] = useState(null);
  const [sort, setSort] = useState("qabPct");

  /**
   * Sorting is presentation only — no statistic is recalculated here.
   *
   * Batting average is deliberately absent: at-bats and hits are not recorded
   * anywhere in the model, so an AVG would have to be inferred from QAB
   * reasons and would be wrong. These four are the metrics that exist.
   */
  const sortedPlayers = useMemo(() => {
    const list = [...players];
    if (sort === "name") {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sort === "pa") {
      return list.sort((a, b) => b.pa - a.pa || a.name.localeCompare(b.name));
    }
    if (sort === "qab") {
      return list.sort((a, b) => b.qab - a.qab || b.pa - a.pa || a.name.localeCompare(b.name));
    }
    // Null percentage means no plate appearances, which sorts last rather
    // than reading as zero.
    return list.sort(
      (a, b) =>
        (b.qabPct ?? -1) - (a.qabPct ?? -1) || b.pa - a.pa || a.name.localeCompare(b.name)
    );
  }, [players, sort]);

  if (team.pa === 0) {
    return (
      <section className="season">
        <div className="season-head">
          <h2 className="season-title">Season performance</h2>
        </div>
        <p className="season-none">
          Quality At-Bats you record during games will be summarised here.
        </p>
      </section>
    );
  }

  const recorded = reasons.filter((r) => r.count > 0);
  const shown = allReasons ? reasons : recorded;
  const maxReason = Math.max(1, ...reasons.map((r) => r.count));

  return (
    <section className="season">
      <div className="season-head">
        <h2 className="season-title">Season performance</h2>
        <div className="season-toggle" role="tablist" aria-label="Season performance view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "team"}
            className={view === "team" ? "on" : ""}
            onClick={() => setView("team")}
          >
            Team
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "players"}
            className={view === "players" ? "on" : ""}
            onClick={() => setView("players")}
          >
            Players
          </button>
        </div>
      </div>

      {/* Counts sit on the same baseline as the percentage, never beneath it.
          At small samples the counts are the trustworthy half. */}
      <div className="season-hero">
        <div className="season-hero-main">
          <p className="season-label">Season QAB%</p>
          <p className="season-hero-line">
            <span className="season-pct">{team.qabPct == null ? "—" : `${team.qabPct}%`}</span>
            <span className="season-counts">
              <strong>{team.qab}</strong> QAB <span aria-hidden="true">/</span>{" "}
              <strong>{team.pa}</strong> PA
            </span>
          </p>
        </div>

        <div className="season-tallies">
          <span>
            <strong>{team.games}</strong>
            <em>{team.games === 1 ? "Game" : "Games"}</em>
          </span>
          <span>
            <strong>{team.players}</strong>
            <em>{team.players === 1 ? "Player" : "Players"}</em>
          </span>
          <span>
            <strong>{team.tournaments}</strong>
            <em>{team.tournaments === 1 ? "Tournament" : "Tournaments"}</em>
          </span>
        </div>

        <div className="season-meter" aria-hidden="true">
          <span style={{ width: `${team.qabPct ?? 0}%` }} />
        </div>

        {/* Season record covers ALL games with a recorded result, which is a
            different scope from the Games / Players / Tournaments counts above
            — those describe QAB-tracked data. Kept as supporting copy rather
            than a tile so the two scopes are not visually equated.

            Omitted entirely when no game has a result: 0-0 would read as a
            season played and lost nothing. */}
        {record?.played > 0 && (
          <p className="season-record">
            Season record{" "}
            <strong>
              {record.w}–{record.l}
              {record.t > 0 && `–${record.t}`}
            </strong>{" "}
            · {record.winPct}% ·{" "}
            {record.played} of {record.total}{" "}
            {record.total === 1 ? "game" : "games"} with a result recorded
          </p>
        )}
      </div>

      {view === "team" ? (
        <>
          <div className="season-card season-games">
            <p className="season-label">Games</p>
            <p className="season-sub">How we did in each game we tracked.</p>

            {games.length === 0 ? (
              <p className="season-none">No games tracked yet.</p>
            ) : (
              <>
                <div className="gm-head" aria-hidden="true">
                  <span />
                  <span>Opponent</span>
                  <span>Result</span>
                  <span>QAB / PA</span>
                  <span>QAB%</span>
                  <span>Status</span>
                </div>
                <ul className="gm-list">
                {games.map((g) => {
                  const open = openGame === g.gameId;
                  return (
                    <li key={g.gameId} className={open ? "open" : ""}>
                      <button
                        type="button"
                        className="gm-row"
                        aria-expanded={open}
                        onClick={() => setOpenGame(open ? null : g.gameId)}
                      >
                        <span className="gm-caret" aria-hidden="true">
                          {open ? "▾" : "▸"}
                        </span>

                        <span className="gm-id">
                          <span className="gm-opp">{g.opponent}</span>
                          <span className="gm-meta">
                            {fmtDate(g.gameDate)}
                            {g.tournament && ` · ${g.tournament}`}
                          </span>
                        </span>

                        <span className="gm-outcome">
                          {g.hasScore ? (
                            <>
                              <span className={`gm-res gm-res-${(g.result ?? "").toLowerCase()}`}>
                                {g.result}
                              </span>
                              <span className="gm-score">
                                {g.runsFor}–{g.runsAgainst}
                              </span>
                            </>
                          ) : (
                            <span className="gm-noscore">No score recorded</span>
                          )}
                        </span>

                        <span className="gm-figs">
                          <strong>{g.qab}</strong>
                          <span aria-hidden="true"> / </span>
                          <strong>{g.pa}</strong>
                          <em>QAB / PA</em>
                        </span>

                        <span className="gm-pct">{g.qabPct == null ? "—" : `${g.qabPct}%`}</span>

                        {/* Explicit completion, never inferred from the score. */}
                        <span className={`gm-status${g.completed ? " done" : ""}`}>
                          {g.completed ? "Complete" : "Tracking in progress"}
                        </span>
                      </button>

                      {open && <LineupContribution game={g} />}
                    </li>
                  );
                })}
                </ul>
              </>
            )}
          </div>

          <div className="season-card">
            <p className="season-label">Reasons cited</p>
            {/* One plate appearance can cite several reasons and still be one
                quality at-bat, so these two totals are always stated apart. */}
            <p className="season-sub">
              {reasonsCited} {reasonsCited === 1 ? "reason" : "reasons"} cited across {team.qab}{" "}
              {team.qab === 1 ? "quality at-bat" : "quality at-bats"}
            </p>

            <ul className="season-rlist">
              {shown.map((r) => (
                <li key={r.key}>
                  <span className="season-rname">{r.label}</span>
                  <span className={`season-rbar${r.count === 0 ? " zero" : ""}`} aria-hidden="true">
                    <span style={{ width: `${(r.count / maxReason) * 100}%` }} />
                  </span>
                  <span className="season-rnum">{r.count}</span>
                </li>
              ))}
            </ul>

            {recorded.length < reasons.length && (
              <button
                type="button"
                className="season-more"
                onClick={() => setAllReasons((v) => !v)}
              >
                {allReasons ? "Show recorded reasons" : "View all reasons"}
              </button>
            )}
          </div>

          <QabTrend games={games} seasonPct={team.qabPct} />

          <p className="season-trend-line">
            {gamesCompleted} of {team.games} tracked {team.games === 1 ? "game" : "games"} complete
          </p>
        </>
      ) : (
        <div className="season-card">
          <div className="season-phead">
            <p className="season-label">All players with recorded at-bats</p>
            <label className="season-sort" htmlFor="season-sort">
              <span className="season-sort-label">Sort by</span>
              <select id="season-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="qabPct">QAB %, highest first</option>
                <option value="qab">Quality at-bats</option>
                <option value="pa">Plate appearances</option>
                <option value="name">Player name</option>
              </select>
            </label>
          </div>
          {/* Column header for the aligned figures. The row is a button, so
              this is a presentational header rather than a table head. */}
          <div className="season-phead-cols" aria-hidden="true">
            <span className="season-pcol-name">Player</span>
            <span className="season-pcol-num">QAB</span>
            <span className="season-pcol-num">PA</span>
            <span className="season-pcol-num">QAB%</span>
          </div>

          <ul className="season-plist">
            {sortedPlayers.map((p) => {
              const open = openPlayer === p.playerId;
              return (
                <li key={p.playerId} className={open ? "open" : ""}>
                  <button
                    type="button"
                    className="season-prow"
                    aria-expanded={open}
                    onClick={() => setOpenPlayer(open ? null : p.playerId)}
                  >
                    <span className="season-pcaret" aria-hidden="true">
                      {open ? "▾" : "▸"}
                    </span>
                    <span className="season-pname">{p.name}</span>
                    {/* Three aligned numeric columns. The Early badge is gone:
                        with a 10-PA threshold it appeared on nearly every
                        player early in a season, so it marked the norm rather
                        than the exception. The note above the table carries
                        the same caution once. */}
                    <span className="season-pnum">{p.qab}</span>
                    <span className="season-pnum">{p.pa}</span>
                    <span className="season-pnum season-pnum-pct">
                      {p.qabPct == null ? "—" : `${p.qabPct}%`}
                    </span>
                  </button>

                  {open && (
                    <div className="pex">
                      {p.qab === 0 ? (
                        <p className="pex-none">No quality at-bats recorded yet.</p>
                      ) : (
                        <>
                          <p className="pex-title">Quality At-Bat breakdown</p>
                          {/* Occurrences for this player. One plate appearance
                              can cite several reasons and is still one QAB, so
                              these counts are never totalled as a QAB figure. */}
                          <ul className="pex-list">
                            {p.reasons.map((r) => (
                              <li key={r.key}>
                                <span className="pex-label">{r.label}</span>
                                <span className="pex-count">{r.count}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}


/**
 * Team QAB% per game, in date order.
 *
 * Every figure is already computed by the server-side performance query —
 * gameRows carry qabPct, qab, pa, opponent and gameDate. Nothing is recomputed
 * and no statistic is invented: a game with no plate appearances has no point
 * rather than a zero, and the line joins only the games that exist. There is
 * no interpolation and no smoothing.
 *
 * Plain SVG on a 0–100 scale, so the vertical position of a point means the
 * same thing in every season regardless of how the team is performing.
 */
function QabTrend({ games, seasonPct }) {
  const points = (games ?? []).filter((g) => g.pa > 0 && g.qabPct != null);

  if (points.length === 0) return null;

  // One game is a fact, not a trend. Stating it is more honest than drawing a
  // line through a single point.
  if (points.length === 1) {
    const only = points[0];
    return (
      <section className="qtrend">
        <p className="qtrend-h">QAB% by game</p>
        <p className="qtrend-single">
          <strong>{only.qabPct}%</strong> vs {only.opponent} · {only.qab} of {only.pa} plate
          appearances. A second tracked game will start the trend.
        </p>
      </section>
    );
  }

  const W = 640;
  const H = 132;
  const padX = 10;
  const padY = 14;
  const stepX = points.length > 1 ? (W - padX * 2) / (points.length - 1) : 0;
  const y = (pct) => padY + (1 - pct / 100) * (H - padY * 2);
  const x = (i) => padX + i * stepX;

  const path = points.map((g, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(g.qabPct)}`).join(" ");
  const seasonY = seasonPct != null ? y(seasonPct) : null;

  return (
    <section className="qtrend">
      <div className="qtrend-head">
        <p className="qtrend-h">QAB% by game</p>
        {seasonPct != null && (
          <p className="qtrend-key">
            <span className="qtrend-key-line" aria-hidden="true" /> Season {seasonPct}%
          </p>
        )}
      </div>

      <svg
        className="qtrend-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Team QAB percentage across ${points.length} tracked games, ${points
          .map((g) => `${g.opponent} ${g.qabPct}%`)
          .join(", ")}`}
      >
        {seasonY != null && (
          <line
            className="qtrend-season"
            x1={padX}
            x2={W - padX}
            y1={seasonY}
            y2={seasonY}
          />
        )}

        <path className="qtrend-path" d={path} />

        {points.map((g, i) => (
          <circle key={g.gameId} className="qtrend-dot" cx={x(i)} cy={y(g.qabPct)} r="4">
            {/* Native tooltip: no hover state to manage, and it works on
                keyboard focus and in screen readers. */}
            <title>{`${g.opponent} · ${g.qabPct}% · ${g.qab} of ${g.pa} PA`}</title>
          </circle>
        ))}
      </svg>

      <ol className="qtrend-labels">
        {points.map((g) => (
          <li key={g.gameId} title={`${g.opponent} · ${g.qabPct}% · ${g.qab} of ${g.pa} PA`}>
            <span className="qtrend-label-opp">{g.opponent}</span>
            <span className="qtrend-label-pct">{g.qabPct}%</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
