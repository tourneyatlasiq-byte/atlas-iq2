"use client";

import { useState } from "react";
import Link from "next/link";
import { money } from "../../lib/finance-rules";

/**
 * The parent Season Budget document, plus a screen-only toolbar.
 *
 * The toolbar carries the coach's optional note, any data-quality warnings and
 * the Print action; it is `.rpt-no-print` and never appears in the PDF. The
 * note is NOT persisted in V1 — it lives in component state for this one
 * document, which is why the hint says so plainly rather than letting a coach
 * assume it was saved.
 *
 * Renders only what the report payload contains. It has no access to players,
 * transactions or internal notes, because the query never fetched them.
 */

/** Whole dollars: cents on a parent-facing budget are noise. */
const dollars = (n) =>
  n == null ? "—" : `$${Math.round(Number(n)).toLocaleString("en-US")}`;

/** Enough distinct tones for a typical budget; repeats beyond that. */
const SEGMENT_COLORS = [
  "#0b2341", "#2f80ed", "#7d9bc1", "#f4b400",
  "#2e7d32", "#8c6d3f", "#64748b", "#b3c6dc",
];

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

export function SeasonBudgetReport({ report }) {
  const [note, setNote] = useState("");

  const blocking = report.warnings.filter((w) => w.blocking);
  const notices = report.warnings.filter((w) => !w.blocking);

  if (report.blocked) {
    return (
      <div className="rpt-shell">
        <div className="rpt-blocked">
          <h2>This report can&rsquo;t be created yet</h2>
          {blocking.map((w, i) => (
            <p key={i}>{w.message}</p>
          ))}
          <p style={{ marginTop: 14 }}>
            <Link href="/finance">← Back to Finance</Link>
          </p>
        </div>
      </div>
    );
  }

  const { organization, team, season, allocation, dues, otherIncome } = report;
  const generated = fmtDate(report.generatedAt);

  return (
    <div className="rpt-shell">
      {/* Screen only. Never printed. */}
      <div className="rpt-bar rpt-no-print">
        <div className="rpt-bar-head">
          <div>
            <p className="rpt-bar-title">Parent budget report</p>
            <p className="rpt-bar-sub">
              Preview below. Print or save as PDF to share with families.
            </p>
          </div>
          <Link href="/finance" className="rpt-btn rpt-btn-secondary" style={{ textDecoration: "none" }}>
            ← Finance
          </Link>
        </div>

        {notices.map((w, i) => (
          <div key={i} className="rpt-warn rpt-warn-note">{w.message}</div>
        ))}

        <div className="rpt-note-field">
          <label htmlFor="rpt-note">Note to parents (optional)</label>
          <textarea
            id="rpt-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What dues cover, how to pay, and any costs families should expect outside team dues — travel, hotels, meals."
          />
          <p className="rpt-note-hint">
            Appears at the end of the report. Not saved — if you create this report again, you&rsquo;ll
            need to retype it.
          </p>
        </div>

        <div className="rpt-actions">
          <button type="button" className="rpt-btn rpt-btn-primary" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* The document. */}
      <article className="rpt-page">
        <header className="rpt-head">
          {organization.logoUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="rpt-logo" src={organization.logoUrl} alt="" />
          )}
          <p className="rpt-org">{organization.name}</p>
          {team.name && <p className="rpt-team">{team.name}</p>}
          <h1 className="rpt-doc-title">Planned Season Budget</h1>
          <p className="rpt-doc-meta">
            {season.name} season{generated ? ` · Prepared ${generated}` : ""}
          </p>
        </header>

        <section className="rpt-section">
          <p className="rpt-h">Season budget</p>
          <p className="rpt-total">{dollars(report.totalBudget)}</p>
          <p className="rpt-lead">
            This is what the team plans to spend across the {season.name} season. It covers
            everything the team pays for together — the categories below show where it goes.
          </p>
        </section>

        <section className="rpt-section">
          <p className="rpt-h">Where the money goes</p>

          <div className="rpt-alloc-bar" role="img" aria-label={
            allocation.categories.map((c) => `${c.category} ${c.percent}%`).join(", ")
          }>
            {allocation.categories.map((c, i) => (
              <span
                key={c.category}
                className="rpt-alloc-seg"
                style={{
                  width: `${c.percent}%`,
                  background: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                }}
              />
            ))}
          </div>

          <table className="rpt-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="rpt-num">Planned</th>
              </tr>
            </thead>
            <tbody>
              {allocation.categories.map((c, i) => (
                <tr key={c.category}>
                  <td>
                    <span
                      className="rpt-swatch"
                      style={{ background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
                      aria-hidden="true"
                    />
                    {c.category}
                    {/* Share sits with the name rather than as a third heavy
                        numeric column; the bar above already carries shape. */}
                    <span className="rpt-share"> · {c.percent}%</span>
                  </td>
                  <td className="rpt-num">{dollars(c.budgeted)}</td>
                </tr>
              ))}
              <tr className="rpt-total-row">
                <td>Total</td>
                <td className="rpt-num">{dollars(allocation.total)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="rpt-section">
          <p className="rpt-h">Player dues</p>

          {dues.status === "varied" ? (
            <>
              <div className="rpt-figures">
                <div>
                  <span className="rpt-fig-label">Dues per player</span>
                  <span className="rpt-fig-value">
                    {dollars(dues.min)} – {dollars(dues.max)}
                  </span>
                </div>
                <div>
                  <span className="rpt-fig-label">Players on the roster</span>
                  <span className="rpt-fig-value rpt-fig-sm">{dues.activeRosterCount}</span>
                </div>
              </div>
              <p className="rpt-caveat">
                Dues vary by player this season. Your family&rsquo;s amount is confirmed separately by
                the coach.
              </p>
            </>
          ) : (
            <>
              <div className="rpt-figures">
                <div>
                  <span className="rpt-fig-label">Dues per player</span>
                  <span className="rpt-fig-value">{dollars(dues.perPlayer)}</span>
                </div>
                <div>
                  <span className="rpt-fig-label">Players on the roster</span>
                  <span className="rpt-fig-value rpt-fig-sm">{dues.activeRosterCount}</span>
                </div>
                {/* Only shown when the set of players it covers fairly
                    describes the roster. Otherwise it would read as a whole-team
                    figure when it is not. */}
                {dues.expectedTotal != null && (
                  <div>
                    <span className="rpt-fig-label">Expected total dues</span>
                    <span className="rpt-fig-value rpt-fig-sm">{dollars(dues.expectedTotal)}</span>
                  </div>
                )}
              </div>

              {dues.expectedTotal == null && (
                <p className="rpt-caveat">
                  Dues are currently set for {dues.withDues} of {dues.activeRosterCount} players, so a
                  team total is not shown here yet.
                </p>
              )}

              {dues.expectedTotal != null && dues.missingCount > 0 && (
                <p className="rpt-caveat">
                  Based on the {dues.withDues} players whose dues are set.{" "}
                  {dues.missingCount === 1 ? "One more player is" : `${dues.missingCount} more players are`}{" "}
                  still being confirmed.
                </p>
              )}
            </>
          )}
        </section>

        {otherIncome.total > 0 && (
          <section className="rpt-section">
            <p className="rpt-h">Expected fundraising &amp; sponsorship</p>
            <div className="rpt-figures">
              <div>
                <span className="rpt-fig-label">Planned this season</span>
                <span className="rpt-fig-value rpt-fig-sm">{dollars(otherIncome.total)}</span>
              </div>
            </div>
            <p className="rpt-lead" style={{ marginTop: 10 }}>
              {otherIncome.lines.map((l) => l.name).join(" · ")}
            </p>
          </section>
        )}

        {note.trim() && (
          <section className="rpt-section">
            <p className="rpt-h">From your coach</p>
            <p className="rpt-note">{note.trim()}</p>
          </section>
        )}

        <footer className="rpt-foot">
          Planned budget as of {generated}. Amounts may change during the season.
        </footer>
      </article>
    </div>
  );
}
