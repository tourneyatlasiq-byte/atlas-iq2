"use client";

import Link from "next/link";

import { useEffect, useMemo, useRef, useState } from "react";
import { gameLinkLabelFor } from "../lib/performance-links";
import { splitByActivity } from "../lib/performance-groups";

import {
  indexAtX,
  indexForKey,
  scaleLabel,
  shortDate,
  thinLabels,
  trendGroups,
  trendPoints,
  trendScale,
  trendSegments,
} from "../lib/qab-trend";

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

      <p className="lc-title">Player performance this game</p>
      <p className="lc-sub">QAB performance through the batting order</p>

      {/* A grid rather than twelve full-width rows. The bars are gone: at this
          density they cost more height than they earned, and the figures they
          encoded are stated directly beside each name. Same values, same
          batting order, roughly a third of the vertical space. */}
      <ul className="lc-grid">
        {game.lineup.map((s) => (
          <li key={`${s.battingOrder ?? "x"}-${s.playerId}`} className="lc-cell">
            <span className="lc-slot">{s.battingOrder ?? "—"}</span>
            <span className="lc-name">{s.name}</span>
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

export function PerformanceSeason({ team, reasons, reasonsCited, players, games, gamesCompleted, record, gameLinkLabel = null, canOpenPlayerReport = false }) {
  const [view, setView] = useState("team");
  const [allReasons, setAllReasons] = useState(false);
  const [openGame, setOpenGame] = useState(null);
  const [openPlayer, setOpenPlayer] = useState(null);
  const [sort, setSort] = useState("qabPct");
  const [showInactive, setShowInactive] = useState(false);

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

  const groups = useMemo(() => splitByActivity(sortedPlayers), [sortedPlayers]);

  function renderPlayer(p) {
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
            <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
              <path d="M5.5 3.5 10.5 8l-5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="season-pname">{p.name}</span>
          {/* Three aligned numeric columns. The note above the table carries
              the small-sample caution once. */}
          <span className="season-pnum">{p.qab}</span>
          <span className="season-pnum">{p.pa}</span>
          <span className="season-pnum season-pnum-pct">
            {p.qabPct == null ? "—" : `${p.qabPct}%`}
          </span>
        </button>

        {open && <PlayerDetail player={p} canOpenPlayerReport={canOpenPlayerReport} />}
      </li>
    );
  }

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
                <div className={`gm-head${gameLinkLabel ? " gm-head-link" : ""}`} aria-hidden="true">
                  <span />
                  <span>Opponent</span>
                  <span>Result</span>
                  <span>QAB / PA</span>
                  <span>QAB%</span>
                  <span>Status</span>
                  {gameLinkLabel && <span />}
                </div>
                <ul className="gm-list">
                {games.map((g) => {
                  const open = openGame === g.gameId;
                  // Linkable rows (2026-11-19): the whole row opens the game
                  // through the visible link, which is stretched over the row
                  // (see .gm-line). One link in the tab order, never two. The
                  // lineup details keep their own caret button, above the link.
                  const linkable = Boolean(gameLinkLabel && g.tournamentId);
                  const linkLabel = gameLinkLabelFor(gameLinkLabel, g.completed);
                  const cells = (
                    <>
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
                    </>
                  );
                  const caret = (
                    <span className="gm-caret" aria-hidden="true">
                      {open ? "▾" : "▸"}
                    </span>
                  );
                  return (
                    <li key={g.gameId} className={`${open ? "open" : ""}${gameLinkLabel ? " gm-item" : ""}`.trim() || undefined}>
                      {linkable ? (
                        /* Every tracked game in the season links to its tracker
                           (2026-11), so last weekend's game can still be reviewed
                           and corrected after the next tournament is added. */
                        <div className="gm-line">
                          <div className="gm-row">
                            <button
                              type="button"
                              className="gm-toggle"
                              aria-expanded={open}
                              aria-label={`${open ? "Hide" : "Show"} lineup details for ${g.opponent}`}
                              onClick={() => setOpenGame(open ? null : g.gameId)}
                            >
                              {caret}
                            </button>
                            {cells}
                          </div>
                          <Link
                            className="btn btn-ghost gm-edit"
                            href={`/tournaments/${g.tournamentId}/games/${g.gameId}/track`}
                            aria-label={`${linkLabel.replace(/\s*→\s*$/, "")}: ${g.opponent}`}
                          >
                            {linkLabel}
                          </Link>
                        </div>
                      ) : (
                        <div className={gameLinkLabel ? "gm-line" : undefined}>
                          <button
                            type="button"
                            className="gm-row"
                            aria-expanded={open}
                            onClick={() => setOpenGame(open ? null : g.gameId)}
                          >
                            {caret}
                            {cells}
                          </button>
                          {gameLinkLabel && <span />}
                        </div>
                      )}

                      {open && <LineupContribution game={g} />}
                    </li>
                  );
                })}
                </ul>
              </>
            )}
          </div>

          <div className="season-card">
            <p className="season-label">QAB reasons</p>
            {/* One primary reason per quality at-bat (2026-11), so these counts
                total the QAB count. A plate appearance saved before that rule
                with two reasons is called out rather than hidden. */}
            <p className="season-sub">
              {team.qab} {team.qab === 1 ? "quality at-bat" : "quality at-bats"} by primary reason
            </p>
            {reasonsCited > team.qab && (
              <details className="season-note">
                <summary>
                  Counts total {reasonsCited}, not {team.qab}. Why?
                </summary>
                <p>
                  Reason counts total {reasonsCited}: a plate appearance saved before the one-reason
                  rule still has more than one reason. Choose its primary reason in the game tracker.
                </p>
              </details>
            )}

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

          <ul className="season-plist">{groups.active.map(renderPlayer)}</ul>

          {/* Inactive players keep every at-bat and total; they are only
              listed apart, collapsed, with the count always visible. */}
          {groups.inactive.length > 0 && (
            <div className="season-inactive">
              <button
                type="button"
                className="season-inactive-toggle"
                aria-expanded={showInactive}
                aria-controls="season-inactive-list"
                onClick={() => setShowInactive((v) => !v)}
              >
                <span className="season-pcaret" aria-hidden="true">{showInactive ? "▾" : "▸"}</span>
                Inactive players ({groups.inactive.length})
              </button>
              {showInactive && <ul className="season-plist" id="season-inactive-list">{groups.inactive.map(renderPlayer)}</ul>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}


/**
 * Team QAB% per game, in date order (redesigned 2026-11).
 *
 * Every figure is already computed by the server-side performance query. Nothing
 * is recomputed and no statistic is invented: a game with no plate appearances
 * has no point, there is no smoothing, and the season reference is the page's
 * own season figure (all recorded, non-voided plate appearances, including a
 * game still being tracked).
 *
 * The vertical scale is ZOOMED to this season's range so game-to-game movement
 * is visible, and the scale is always stated beneath the chart. Labelled
 * gridlines carry the values. A game still being tracked is drawn as a dotted,
 * hollow, asterisked point joined by a dotted segment, and the readout says it
 * can still change, so unfinished work is never read as a final result.
 *
 * One behaviour for any season length: the same chart for 3 games or 30. The
 * detail for a game (opponent, result, score, count) lives in a single readout
 * above the chart, driven by hover, touch or the arrow keys, because labels
 * under each point cannot survive 30 games on a phone.
 *
 * Accessibility: the plot is one slider (arrow keys, Home, End) whose spoken
 * value is the game's full detail; the drawing itself is decorative.
 */
export function QabTrend({ games, seasonPct }) {
  const points = trendPoints(games);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState(null);
  const drawn = points.length >= 2;

  // Draw at the width actually available, so type stays the same size on a
  // phone and a desktop instead of scaling with the drawing.
  useEffect(() => {
    const el = wrapRef.current;
    if (!drawn || !el) return undefined;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawn]);

  if (points.length === 0) return null;

  // One game is a fact, not a trend. Stating it is more honest than drawing a
  // line through a single point.
  if (points.length === 1) {
    const only = points[0];
    return (
      <section className="qtrend">
        <p className="qtrend-h">QAB% by game</p>
        <p className="qtrend-single">
          <strong>
            {only.qabPct}%{only.completed ? "" : "*"}
          </strong>{" "}
          vs {only.opponent} · {only.qab} of {only.pa} plate appearances.{" "}
          {only.completed
            ? "A second tracked game will start the trend."
            : "This game is still being tracked, so the percentage can change."}
        </p>
      </section>
    );
  }

  const n = points.length;
  const W = width > 0 ? width : 720;
  const phone = W < 480;
  const H = phone ? 178 : 196;
  const padL = 34;
  const padR = phone ? 8 : 92;
  const top = phone ? 8 : 20;
  const lane = phone ? 34 : 36;
  const PH = H - top - lane;
  const plotW = W - padL - padR;
  const slot = plotW / n;
  const radius = n > 16 ? 3 : 4.2;

  const scale = trendScale(points.map((g) => g.qabPct), seasonPct);
  const x = (i) => padL + (i + 0.5) * slot;
  const y = (pct) => top + (1 - (pct - scale.lo) / (scale.hi - scale.lo)) * PH;

  const sel = picked == null ? n - 1 : Math.min(picked, n - 1);
  const cur = points[sel];
  const groups = trendGroups(points);
  const segments = trendSegments(points);
  const anyProvisional = points.some((g) => !g.completed);
  const anyResult = points.some((g) => g.result);
  const seasonY = seasonPct != null ? y(seasonPct) : null;

  const describe = (g, i) =>
    `Game ${i + 1}, ${shortDate(g.gameDate) ?? "no date"} versus ${g.opponent}, ${g.qabPct} percent, ${g.qab} of ${g.pa} plate appearances` +
    `${g.result ? `, ${g.result === "W" ? "win" : g.result === "L" ? "loss" : "tie"}` : ""}` +
    `${g.completed ? "" : ", in progress, can still change"}`;

  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPicked(indexAtX(e.clientX - r.left, 0, r.width, n));
  };

  const dateLabels = thinLabels(
    groups
      .map((gr) => ({ x: padL + gr.start * slot + 3, text: shortDate(points[gr.start].gameDate) }))
      .filter((l) => l.text)
  );

  return (
    <section className="qtrend">
      <div className="qtrend-head">
        <p className="qtrend-h">QAB% by game</p>
        <p className="qtrend-keys">
          {seasonPct != null && (
            <span className="qtrend-key">
              <span className="qtrend-key-line" aria-hidden="true" /> Season {seasonPct}%
            </span>
          )}
          {anyProvisional && (
            <span className="qtrend-key">
              <span className="qtrend-key-live" aria-hidden="true" /> In progress
            </span>
          )}
        </p>
      </div>

      {/* The selected game's detail. Compact on a desktop so it does not
          compete with the trend; larger on a phone, where a tap must produce an
          obvious response. The slider below announces the same text. */}
      <div className="qtrend-ro" aria-hidden="true">
        <span className="qtrend-ro-g">G{sel + 1}</span>
        <span className="qtrend-ro-opp">
          {shortDate(cur.gameDate) ? `${shortDate(cur.gameDate)} ` : ""}vs {cur.opponent}
        </span>
        {cur.result && (
          <span className={`gm-res gm-res-${cur.result.toLowerCase()}`}>{cur.result}</span>
        )}
        {cur.hasScore && (
          <span className="qtrend-ro-score">
            {cur.runsFor}–{cur.runsAgainst}
          </span>
        )}
        {!cur.completed && <span className="qtrend-pill">In progress, can still change</span>}
        {cur.tournament && <span className="qtrend-ro-t">{cur.tournament}</span>}
        <span className="qtrend-ro-pct">
          {cur.qabPct}%{cur.completed ? "" : "*"}
        </span>
        <span className="qtrend-ro-n">
          {cur.qab} of {cur.pa} PA
        </span>
      </div>

      <div className="qtrend-wrap" ref={wrapRef}>
        <svg className="qtrend-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
          {groups.map((gr, k) => {
            const x0 = padL + gr.start * slot;
            const w = (gr.end - gr.start + 1) * slot;
            const chars = Math.floor((w - 10) / 5.6);
            const label = gr.name.length > chars ? `${gr.name.slice(0, Math.max(0, chars - 1))}…` : gr.name;
            return (
              <g key={`${gr.key}-${gr.start}`}>
                {k % 2 === 0 && <rect className="qtrend-band" x={x0} y={top} width={w} height={PH} />}
                {!phone && gr.name && chars >= 4 && (
                  <text className="qtrend-band-name" x={x0 + 5} y={top - 6}>
                    {label}
                  </text>
                )}
                {k > 0 && <line className="qtrend-sep" x1={x0} x2={x0} y1={top} y2={top + PH + 4} />}
              </g>
            );
          })}

          {scale.ticks.map((t) => (
            <g key={t}>
              <line className="qtrend-grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
              <text className="qtrend-tick" x={padL - 6} y={y(t) + 3.5} textAnchor="end">
                {t}%
              </text>
            </g>
          ))}

          {seasonY != null && (
            <>
              <line className="qtrend-season" x1={padL} x2={W - padR} y1={seasonY} y2={seasonY} />
              {!phone && (
                <text className="qtrend-season-label" x={W - padR + 8} y={seasonY + 3.5}>
                  Season {seasonPct}%
                </text>
              )}
            </>
          )}

          {/* Solid only between two finished games. */}
          {segments.map((sg) => (
            <line
              key={sg.to}
              className={sg.provisional ? "qtrend-seg prov" : "qtrend-seg"}
              x1={x(sg.from)}
              y1={y(points[sg.from].qabPct)}
              x2={x(sg.to)}
              y2={y(points[sg.to].qabPct)}
            />
          ))}

          {/* The selected game: a guide and a halo. */}
          <line className="qtrend-guide" x1={x(sel)} x2={x(sel)} y1={top} y2={top + PH} />
          <circle className="qtrend-halo" cx={x(sel)} cy={y(cur.qabPct)} r={radius + 6} />

          {points.map((g, i) => (
            <circle
              key={g.gameId}
              className={g.completed ? "qtrend-dot" : "qtrend-dot prov"}
              cx={x(i)}
              cy={y(g.qabPct)}
              r={g.completed ? radius : radius + 1}
            />
          ))}

          {/* Result lane: only where a result is recorded. */}
          {points.map((g, i) =>
            g.result ? (
              <text
                key={g.gameId}
                className={`qtrend-lane qtrend-lane-${g.result.toLowerCase()}`}
                x={x(i)}
                y={top + PH + 14}
                textAnchor="middle"
                style={{ fontSize: n > 16 ? 8.5 : 10 }}
              >
                {g.result}
              </text>
            ) : null
          )}

          {dateLabels.map((l) => (
            <text key={l.x} className="qtrend-date" x={l.x} y={H - 4}>
              {l.text}
            </text>
          ))}
        </svg>

        <div
          className="qtrend-hit"
          role="slider"
          tabIndex={0}
          aria-label={`QAB percentage by game, ${n} games. Use the left and right arrow keys to move between games.`}
          aria-orientation="horizontal"
          aria-valuemin={1}
          aria-valuemax={n}
          aria-valuenow={sel + 1}
          aria-valuetext={describe(cur, sel)}
          style={{ left: padL, width: plotW, top, height: PH + lane }}
          onPointerDown={pick}
          onPointerMove={(e) => {
            // Hover for a mouse; drag for a finger. A touch scrub never needs
            // a precise tap on a small marker.
            if (e.pointerType === "mouse" || e.buttons > 0) pick(e);
          }}
          onKeyDown={(e) => {
            const next = indexForKey(e.key, sel, n);
            if (next !== sel || ["Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key)) {
              e.preventDefault();
              setPicked(next);
            }
          }}
        />
      </div>

      <p className="qtrend-note">
        {scaleLabel(scale)}.{anyResult ? " W, L or T under each game when recorded." : ""}
        {anyProvisional ? " * In progress: still being tracked, so this percentage can change." : ""}
      </p>
    </section>
  );
}


/**
 * The expanded player panel.
 *
 * Two columns on desktop: performance and trend on the left, how the quality
 * at-bats were earned on the right. One column on a narrow screen.
 *
 * Everything is read from data the season view already holds — games[].lineup
 * carries a per-game entry per batter, and player.reasons carries the reason
 * counts. No extra query, no schema, and nothing derived that is not already
 * a recorded figure.
 *
 * Deliberately free of judgement. No "improving", "hot", "consistent": with
 * three to six games and single-figure plate appearances, any such label would
 * be an interpretation the data cannot carry. The panel states the numbers.
 */
function PlayerDetail({ player, canOpenPlayerReport = false }) {
  // Already derived by getSeasonPerformance. This component renders; it does
  // not recompute business figures.
  const history = player.history ?? [];
  const recent = player.recentForm ?? null;

  const maxReason = Math.max(1, ...player.reasons.map((r) => r.count));

  return (
    <div className="pex">
      {/* The player's row above is the panel's header, so the name is not
          repeated. One compact, secondary action sits below it and above the
          figures, right-aligned on a wide screen. Never the screen's one
          primary action. Offered only to roles allowed to open the report,
          and only once the player has at-bats. */}
      {canOpenPlayerReport && player.pa > 0 && (
        <div className="pex-actions">
          <Link
            className="btn btn-secondary pex-report"
            href={`/reports/qab-player?player=${encodeURIComponent(player.playerId)}&from=performance`}
          >
            View player report
          </Link>
        </div>
      )}
      <div className="pex-main">
        <div className="pd-summary">
          <span className="pd-stat">
            <strong>{player.qabPct == null ? "—" : `${player.qabPct}%`}</strong> QAB
          </span>
          <span className="pd-stat">
            <strong>{player.qab}</strong> QAB / <strong>{player.pa}</strong> PA
          </span>
          <span className="pd-stat">
            <strong>{history.length}</strong> {history.length === 1 ? "game" : "games"} with a PA
          </span>
        </div>

        {recent && (
          <p className="pd-recent">
            Last {recent.games} games: <strong>{recent.qabPct}% QAB</strong> · {recent.qab}/
            {recent.pa} PA
          </p>
        )}

        {history.length >= 2 && <PlayerTrend history={history} />}

        {history.length > 0 && (
          <ul className="pgh-recent">
            {history.map((h) => (
              <li key={h.gameId}>
                <span className="pgh-opp">{h.opponent}</span>
                <span className="pgh-figs">{h.qab}/{h.pa}</span>
                <span className="pgh-pct">{h.qabPct}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pex-side">
        {player.qab === 0 ? (
          <p className="pex-none">No quality at-bats recorded yet.</p>
        ) : (
          <>
            <p className="pex-title">How QABs were earned</p>
            {/* One primary reason per quality at-bat, so these counts are
                quality at-bats by reason. */}
            <ul className="pd-reasons">
              {player.reasons.map((r) => (
                <li key={r.key}>
                  <span className="pd-reason-label">{r.label}</span>
                  <span className="pd-reason-bar" aria-hidden="true">
                    <span style={{ width: `${(r.count / maxReason) * 100}%` }} />
                  </span>
                  <span className="pd-reason-count">{r.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * QAB% per game, with each point labelled.
 *
 * The unlabelled sparkline was readable only against the table beneath it.
 * The percentage now sits above its own point, so the sequence can be read on
 * its own. Fixed 0-100 scale, so height means the same thing for every player.
 */
function PlayerTrend({ history }) {
  const W = 420;
  const H = 78;
  const padX = 16;
  const padTop = 20;
  const padBottom = 10;
  const stepX = (W - padX * 2) / (history.length - 1);
  const x = (i) => padX + i * stepX;
  const y = (pct) => padTop + (1 - pct / 100) * (H - padTop - padBottom);
  const path = history.map((h, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(h.qabPct)}`).join(" ");

  return (
    <svg
      className="pgh-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={history.map((h) => `${h.opponent} ${h.qabPct}%`).join(", ")}
    >
      <path className="pgh-path" d={path} />
      {history.map((h, i) => (
        <g key={h.gameId}>
          <circle className="pgh-dot" cx={x(i)} cy={y(h.qabPct)} r="3.5">
            <title>{`${h.opponent} · ${h.qabPct}% · ${h.qab} of ${h.pa} PA`}</title>
          </circle>
          <text
            className="pgh-point-label"
            x={x(i)}
            y={y(h.qabPct) - 8}
            textAnchor={i === 0 ? "start" : i === history.length - 1 ? "end" : "middle"}
          >
            {h.qabPct}%
          </text>
        </g>
      ))}
    </svg>
  );
}
