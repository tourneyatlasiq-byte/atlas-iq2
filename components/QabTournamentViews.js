"use client";

import { useState } from "react";
import { formatQabPct } from "../lib/qab-rules";
import { tournamentDateLabel, playerRowSummary, noPaGames } from "../lib/qab-tournament-rows";

/**
 * Season by tournament, and a player's games with a QAB (2026-11).
 *
 * Presentation only. Every figure is read from rows built by
 * lib/qab-tournament-rows.js, which reads what getSeasonPerformance already
 * derived. Nothing is recalculated here.
 *
 * Shared by the Performance screen, the Season report and the Player report so
 * a coach sees the same thing in all three. Ink on white, no colour emphasis:
 * every state is readable in grayscale, on screen and in print.
 *
 * Wording rules:
 *   - "Tracking in progress" is per game. A tournament row says it only because
 *     one of its games is unfinished; dates never decide it.
 *   - A bar is striped only when ITS figures include an unfinished game.
 *   - The season tick and the provisional note are each explained once, in the
 *     key under the list, never on every row.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function barLabel(r) {
  const base = `${r.name}: ${formatQabPct(r.qabPct)}, ${r.qab} QAB in ${r.pa} PA`;
  return r.includesUnfinished ? `${base}. Includes a game still being tracked` : base;
}

/** QAB% by tournament. `rows` from tournamentRows() or playerTournamentView().rows. */
export function TournamentBars({ rows, seasonPct = null, tickLabel = "Season QAB%", player = false, headingClass = "qtv-h", title = "QAB% by tournament" }) {
  const anyProvisional = rows.some((r) => r.includesUnfinished);
  const tick = seasonPct != null && rows.some((r) => r.pa > 0);
  return (
    <section className="qtv" aria-label={title}>
      <h3 className={headingClass}>{title}</h3>
      <ul className="qtv-rows">
        {rows.map((r) => {
          const dates = tournamentDateLabel(r.firstDate, r.lastDate);
          // A tournament with no plate appearance says so plainly. A player row
          // counts the games she batted in, never "0 of 1".
          const sub =
            r.pa <= 0 ? "No PA recorded" : player ? playerRowSummary(r) : plural(r.games, "game", "games");
          return (
            <li key={`${r.name}|${r.firstDate}`} className="qtv-row">
              <div className="qtv-top">
                <span className="qtv-name">{r.name}</span>
                {r.pa > 0 && <span className="qtv-pct">{formatQabPct(r.qabPct)}</span>}
              </div>
              <div className="qtv-sub">
                <span>
                  {[dates, sub].filter(Boolean).join(" · ")}
                  {r.trackingInProgress && <strong className="qtv-status"> · Tracking in progress</strong>}
                </span>
                {r.pa > 0 && <span className="qtv-counts">{`${r.qab} QAB / ${r.pa} PA`}</span>}
              </div>
              {r.pa > 0 && (
                <div className="qtv-bar" role="img" aria-label={barLabel(r)}>
                  <span
                    className={`qtv-fill${r.includesUnfinished ? " qtv-fill--prov" : ""}`}
                    style={{ width: `${Math.min(100, Math.max(0, r.qabPct ?? 0))}%` }}
                  />
                  {tick && <i className="qtv-tick" style={{ left: `${Math.min(100, Math.max(0, seasonPct))}%` }} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="qtv-key">
        {tick && (
          <span className="qtv-key-item">
            <i className="qtv-key-tick" aria-hidden="true" /> {tickLabel}: {formatQabPct(seasonPct)}
          </span>
        )}
        {anyProvisional && (
          <span className="qtv-key-item">
            <i className="qtv-key-prov" aria-hidden="true" /> Includes a game still being tracked, so it may change.
          </span>
        )}
      </p>
    </section>
  );
}

const STATUS_WORD = { qab: "QAB recorded", noqab: "Batted, no QAB", nopa: "No PA recorded" };

/** Games with a QAB: one tappable dot per game, grouped by day and tournament. */
export function GameDots({ view, headingClass = "qtv-h", title = "Games with a QAB" }) {
  const [picked, setPicked] = useState(null);
  const all = view.dots.flatMap((t) => t.days.flatMap((d) => d.games));
  const anyUnfinished = all.some((g) => g.unfinished);
  const unordered = view.dots.some((t) => t.days.some((d) => d.games.length > 1 && !d.timesKnown));
  const multiple = view.dots.length > 1;
  // Printed dots cannot be tapped, so games with no plate appearance are also
  // listed by date and opponent. Hidden on screen, where the tap and the label do this.
  const noPa = noPaGames(view);
  const noPaByTournament = [...new Set(noPa.map((x) => x.tournament))].map((name) => ({
    name,
    items: noPa.filter((x) => x.tournament === name).map((x) => x.text),
  }));

  return (
    <section className="qtv" aria-label={title}>
      <h3 className={headingClass}>{title}</h3>
      <p className="qtv-count">
        {view.gamesWithPa > 0
          ? `QAB in ${view.gamesWithQab} of ${view.gamesWithPa} ${view.gamesWithPa === 1 ? "game" : "games"} with a PA.`
          : "No plate appearances recorded yet."}
      </p>

      {view.dots.map((t) => (
        <div className="qtv-tour" key={t.name}>
          {multiple && <p className="qtv-tname">{t.name}</p>}
          <div className="qtv-days">
            {t.days.map((d) => (
              <div className="qtv-day" key={d.date}>
                <span className="qtv-dlabel">{d.label}</span>
                <span className="qtv-dots">
                  {d.games.map((g) => {
                    const key = `${t.name}|${g.gameId}`;
                    return (
                      <button
                        key={g.gameId}
                        type="button"
                        className={`qtv-dot qtv-dot--${g.status}${g.unfinished ? " qtv-dot--open" : ""}`}
                        aria-label={g.label}
                        aria-pressed={picked?.key === key}
                        title={g.label}
                        onClick={() => setPicked(picked?.key === key ? null : { key, label: g.label })}
                      >
                        <span className="qtv-dot-mark" aria-hidden="true" />
                      </button>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="qtv-readout" role="status" aria-live="polite">
        {picked ? picked.label : "Tap a game for its date and opponent."}
      </p>

      <ul className="qtv-legend" aria-label="Key">
        {Object.entries(STATUS_WORD).map(([k, w]) => (
          <li key={k}><i className={`qtv-dot-mark qtv-key-${k}`} aria-hidden="true" /> {w}</li>
        ))}
        {anyUnfinished && <li><i className="qtv-dot-mark qtv-key-open" aria-hidden="true" /> Tracking in progress</li>}
      </ul>
      {noPa.length > 0 && (
        <div className="qtv-print-nopa">
          <p className="qtv-print-nopa-h">No PA recorded</p>
          <ul>
            {noPaByTournament.map((t) => (
              <li key={t.name}>
                {multiple ? <strong>{t.name}: </strong> : null}
                {t.items.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unordered && <p className="qtv-order">Games on the same day are listed by opponent, not in play order.</p>}
    </section>
  );
}

/**
 * The player card: tournament bars (from two tournaments) and the dots.
 * `showDots={false}` leaves the dots out where the game-by-game list already
 * gives each game's QAB and PA (the printed player report).
 */
export function PlayerTournamentCard({ view, seasonPct = null, headingClass = "qtv-h", showDots = true }) {
  if (!view || view.dots.length === 0) return null;
  const showRows = view.rows.length >= 2;
  if (!showDots && !showRows) return null;
  return (
    <div className="qtv-card">
      {showRows && <TournamentBars rows={view.rows} seasonPct={seasonPct} tickLabel="Player season QAB%" player headingClass={headingClass} />}
      {showDots && <GameDots view={view} headingClass={headingClass} />}
    </div>
  );
}
