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
          <h2>This report isn&rsquo;t ready for parents yet</h2>
          <p className="rpt-blocked-lead">
            Season Tempo won&rsquo;t produce a parent-facing budget while the dues figures would be
            inaccurate. Here&rsquo;s what to correct first.
          </p>
          {blocking.map((w, i) => (
            <div key={i} className="rpt-blocked-item">
              {w.title && <p className="rpt-blocked-title">{w.title}</p>}
              <p>{w.message}</p>
            </div>
          ))}
          <p style={{ marginTop: 18 }}>
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

        {/* Coach-facing only. These never render inside the document. */}
        {notices.map((w, i) => (
          <div key={i} className="rpt-warn rpt-warn-note">
            {w.title && <strong>{w.title}. </strong>}
            {w.message}
          </div>
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
          <div className="rpt-head-row">
            <div className="rpt-head-identity">
              <p className="rpt-org">{organization.name}</p>
              {team.name && <p className="rpt-team">{team.name}</p>}
            </div>

            {/* Only when the organization has actually uploaded one. No
                placeholder, no reserved space and no broken-image state —
                the header simply reads as text. logoUrl is the existing
                public storage URL; nothing new is stored or fetched. */}
            {organization.logoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="rpt-logo" src={organization.logoUrl} alt="" />
            )}
          </div>

          <h1 className="rpt-doc-title">Planned Season Budget</h1>
          <p className="rpt-doc-meta">
            {season.name} season{generated ? ` · Prepared ${generated}` : ""}
          </p>
        </header>

        <section className="rpt-section">
          <p className="rpt-h">Season budget</p>
          <p className="rpt-total">{dollars(report.totalBudget)}</p>
          <p className="rpt-lead">
            This budget outlines the planned team expenses for the {season.name} season and gives
            families a clear view of how team funds are expected to be used.
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

        {/* Two independent facts, side by side. Season budget, dues and
            fundraising are not related to one another anywhere in the data
            model, so nothing here nets, offsets or compares them. */}
        <div className="rpt-cards">
          <section className="rpt-card">
            <p className="rpt-h">Player dues</p>

            {dues.status === "varied" ? (
              <>
                <p className="rpt-card-figure">
                  {dollars(dues.min)} – {dollars(dues.max)}
                </p>
                <p className="rpt-card-label">Dues per player</p>
                <p className="rpt-card-line">
                  {dues.activeRosterCount} players on the roster
                </p>
                <p className="rpt-card-foot">
                  Dues vary by player this season. Your family&rsquo;s amount is confirmed
                  separately by the coach.
                </p>
              </>
            ) : (
              <>
                <p className="rpt-card-figure">{dollars(dues.perPlayer)}</p>
                <p className="rpt-card-label">Dues per player</p>
                <p className="rpt-card-line">
                  {dues.activeRosterCount} players on the roster
                </p>
                {dues.expectedTotal != null && (
                  /* Scope stated explicitly. This total covers the CURRENT
                     roster, so it can legitimately differ from Finance's
                     season-wide expected dues, which also counts players who
                     have since left. Naming the scope makes that difference
                     self-explaining rather than alarming. */
                  <p className="rpt-card-line">
                    <strong>{dollars(dues.expectedTotal)}</strong> from the{" "}
                    {dues.activeRosterCount} players on this roster
                  </p>
                )}
              </>
            )}
          </section>

          {otherIncome.total > 0 && (
            <section className="rpt-card">
              <p className="rpt-h">Fundraising &amp; sponsorship</p>
              <p className="rpt-card-figure">{dollars(otherIncome.total)}</p>
              <p className="rpt-card-label">Planned this season</p>
              {/* Activities belong to this card, not floating beneath it. */}
              <ul className="rpt-card-list">
                {otherIncome.lines.map((l) => (
                  <li key={l.name}>
                    <span>{l.name}</span>
                    <span className="rpt-card-list-amt">{dollars(l.budgeted)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {note.trim() && (
          <section className="rpt-section">
            <p className="rpt-h">From your coach</p>
            <p className="rpt-note">{note.trim()}</p>
          </section>
        )}

        {/* One closing statement, not two. The separate planning note and
            footer both said amounts may change, and the prepared date appeared
            here as well as in the header — the same caution and the same date
            three times between them. */}
        <footer className="rpt-foot">
          Budget amounts reflect the team&rsquo;s current season plan and may be updated as
          tournament schedules, team needs, or other season costs are finalized.
        </footer>
      </article>
    </div>
  );
}
