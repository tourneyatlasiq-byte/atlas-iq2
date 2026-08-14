"use client";

import { useState } from "react";

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
export function PerformanceSeason({ team, reasons, reasonsCited, players, tournaments }) {
  const [view, setView] = useState("team");
  const [allReasons, setAllReasons] = useState(false);

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
          <p className="season-label">Quality at-bats</p>
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
      </div>

      {view === "team" ? (
        <div className="season-cols">
          <div className="season-card">
            <p className="season-label">By tournament</p>
            {tournaments.length === 0 ? (
              <p className="season-none">No tournament totals yet.</p>
            ) : (
              <ul className="season-tlist">
                {tournaments.map((t) => (
                  <li key={t.tournamentId}>
                    <p className="season-trow">
                      <span className="season-tname">{t.name}</span>
                      <span className="season-tfig">
                        <strong>{t.qabPct == null ? "—" : `${t.qabPct}%`}</strong>{" "}
                        <span>
                          {t.qab}/{t.pa} PA
                        </span>
                      </span>
                    </p>
                    {/* Thin samples are muted rather than labelled. The counts
                        above already say how much is behind the bar. */}
                    <span className={`season-bar${t.pa < 5 ? " thin" : ""}`} aria-hidden="true">
                      <span style={{ width: `${t.qabPct ?? 0}%` }} />
                    </span>
                    <p className="season-tmeta">
                      {t.games} {t.games === 1 ? "game" : "games"} · {t.players}{" "}
                      {t.players === 1 ? "player" : "players"}
                    </p>
                  </li>
                ))}
              </ul>
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
        </div>
      ) : (
        <div className="season-card">
          <div className="season-phead">
            <p className="season-label">All players with recorded at-bats</p>
            <span className="season-sort">Sorted by plate appearances</span>
          </div>
          <p className="season-sub">
            Percentages from a handful of at-bats move a lot. Counts are shown alongside.
          </p>

          <ul className="season-plist">
            {players.map((p) => (
              <li key={p.playerId}>
                <span className="season-pname">{p.name}</span>
                <span className="season-pcounts">
                  <strong>{p.qab}</strong> QAB <span aria-hidden="true">/</span>{" "}
                  <strong>{p.pa}</strong> PA
                </span>
                <span className="season-ppct">{p.qabPct == null ? "—" : `${p.qabPct}%`}</span>
                {/* Quiet qualifier, not a warning. Disappears on its own once
                    this player has enough plate appearances. */}
                {p.earlyData && <span className="season-early">Early data</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
