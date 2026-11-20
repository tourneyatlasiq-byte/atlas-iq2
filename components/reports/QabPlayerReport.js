"use client";

import { ReportToolbar } from "./ReportToolbar";
import { formatQabPct } from "../../lib/qab-rules";
import { cssString } from "../../lib/qab-player-rules";

/**
 * Individual player QAB report (RPT-002, 2026-11). COACH-FACING.
 *
 * Reads one payload, built by lib/qab-player-rules.js from the same derivation
 * the Performance screen uses. Nothing here computes a QAB figure; it renders
 * the counts it is given. There are no scores, no win/loss/tie and no team
 * comparison on this page, by decision.
 *
 * Phone: one summary, the reason bars, and game rows as a list. Print and
 * desktop: the games as a table per tournament whose heading row repeats when
 * a tournament runs onto another page.
 *
 * PRINT. The running header and "Page X of Y" are page-margin boxes, which
 * Chrome draws only when Margins is set to Default. They are designed for that
 * setting and are not promised elsewhere (see player.css).
 */

// formatQabPct already carries the % sign and prints a dash for no plate appearances.
const pct = formatQabPct;
const sharePct = (v) => (v == null ? "" : formatQabPct(v));
const COVERAGE =
  "Recorded plate appearances only; untracked games are not treated as zero. Games where this player did not bat are not listed.";
const OUTSIDE_NOTE =
  "A game marked outside tournament dates is linked to this tournament but dated outside its dates. It is included because of that link.";
const FOOTER =
  "Quality at-bat (QAB) figures come from plate appearances recorded in Season Tempo; each QAB is counted under one primary reason.";
const PRINT_HELP =
  "For best results, use Chrome, choose Save as PDF or your printer, set Margins to Default, and leave Headers and footers off. Page numbers and the running header are designed for the Default margin setting.";

function fmtGenerated(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function QabPlayerReport({ report, scopeControl = null, from = null }) {
  const { organization, team, season, scope, player, summary, reasons, groups, notes, empty } = report;
  const isTournament = scope.kind === "tournament";
  const generated = fmtGenerated(report.generatedAt);
  const scopeLine = isTournament
    ? `${scope.tournament.name}${scope.tournament.dates ? ` · ${scope.tournament.dates}` : ""}`
    : `Season ${season.name ?? ""}`.trim();
  const runningHeader = [player.name, team.name, season.name ? `${season.name}` : null, "QAB Player Report"].filter(Boolean).join(" · ");
  const hasOutside = groups.some((g) => g.games.some((x) => x.outside));
  const mixMax = Math.max(1, summary.qab);

  return (
    <div className="rpt-shell">
      <ReportToolbar from={from} name="QAB Player Report" controls={scopeControl} notes={notes}>
        {/* Collapsed so the player's information starts sooner on a phone. Screen only: it sits in the toolbar. */}
        <details className="qp-tips">
          <summary>Print tips</summary>
          <p className="qp-help">{PRINT_HELP}</p>
        </details>
      </ReportToolbar>

      {/* The running header cannot read the page, so it is written here with the
          player's name escaped for a CSS string. Margin boxes only draw at Default. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@page qabplayer{@top-left{content:"${cssString(runningHeader)}"}}@page qabplayer:first{@top-left{content:none}}`,
        }}
      />

      <article className="rpt-page qp-doc">
        <header className="qp-head">
          <p className="qp-org">{organization.name ?? team.name}</p>
          {(team.name || player.tag) && (
            <p className="qp-team">
              {team.name}
              {player.tag && <span className="qp-tag">{player.tag}</span>}
            </p>
          )}
          <h1 className="qp-player">{player.name}</h1>
          <p className="qp-meta">QAB Player Report &middot; {scopeLine}</p>
          {generated && <p className="qp-meta">Generated {generated}</p>}
        </header>

        {empty ? (
          <section className="qp-empty">
            <p className="qp-empty-h">No plate appearances recorded</p>
            <p>
              {isTournament
                ? `${player.name} has no recorded plate appearances in ${scope.tournament.name}.`
                : `${player.name} has no recorded plate appearances this season.`}{" "}
              Quality at-bat figures appear once plate appearances are tracked.
            </p>
          </section>
        ) : (
          <>
            <section className="qp-sum" aria-label="Summary">
              <div className="qp-pct">{pct(summary.qabPct)}</div>
              <div className="qp-pl">Quality at-bat rate</div>
              <div className="qp-two">
                <div><b>{summary.qab} / {summary.pa}</b><span>QAB / PA</span></div>
                <div><b>{summary.games}</b><span>{summary.games === 1 ? "Game with a PA" : "Games with a PA"}</span></div>
              </div>
            </section>

            <section>
              <h2 className="qp-h2">How QABs were earned</h2>
              {summary.qab === 0 ? (
                <p className="qp-lead">No quality at-bats recorded in this scope.</p>
              ) : (
                <>
                  <p className="qp-lead">
                    Share of {summary.qab} quality {summary.qab === 1 ? "at-bat" : "at-bats"}, one primary reason each.
                  </p>
                  <ul className="qp-rs">
                    {reasons.map((r) => (
                      <li key={r.label}>
                        <span className="qp-rl">{r.label}</span>
                        <span className="qp-tr" aria-hidden="true"><i style={{ width: `${Math.round((r.count / mixMax) * 100)}%` }} /></span>
                        <span className="qp-rn">{r.count} <em>&middot; {sharePct(r.percent)}</em></span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section>
              <h2 className="qp-h2">Game by game</h2>
              <p className="qp-lead">{COVERAGE}</p>
              {hasOutside && <p className="qp-lead">{OUTSIDE_NOTE}</p>}

              {/* Phone and screen: a list per tournament. Hidden in print. */}
              <div className="qp-lists">
                {groups.map((g) => (
                  <div key={g.tournamentId ?? "none"}>
                    <div className="qp-grp">{g.title}{isTournament && scope.tournament.dates ? <span> &middot; {scope.tournament.dates}</span> : null}</div>
                    <ul className="qp-gl">
                      {g.games.map((x) => (
                        <li key={x.id}>
                          <span className="qp-o">{x.opponent ? `vs ${x.opponent}` : "Opponent not recorded"}</span>
                          <span className="qp-f">{x.qab} / {x.pa}</span>
                          <span className="qp-d">{x.day}{x.outside ? " \u00b7 outside tournament dates" : ""}</span>
                          <span className="qp-p">{pct(x.qabPct)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Desktop and print: one table per tournament. The heading row
                  sits in thead, so it repeats on a continuation page. */}
              {groups.map((g) => (
                <table className="qp-tbl" key={g.tournamentId ?? "none"}>
                  <thead>
                    <tr className="qp-g"><th colSpan={4}>{g.title}{isTournament && scope.tournament.dates ? <span> &middot; {scope.tournament.dates}</span> : null}</th></tr>
                    <tr><th>Date</th><th>Opponent</th><th className="r">QAB / PA</th><th className="r">QAB%</th></tr>
                  </thead>
                  <tbody>
                    {g.games.map((x) => (
                      <tr key={x.id}>
                        <td>{x.day}</td>
                        <td>{x.opponent ? `vs ${x.opponent}` : "Opponent not recorded"}{x.outside ? " (outside tournament dates)" : ""}</td>
                        <td className="r">{x.qab} / {x.pa}</td>
                        <td className="r">{pct(x.qabPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </section>
          </>
        )}

        <p className="qp-foot">{FOOTER}</p>
      </article>
    </div>
  );
}
