"use client";

import { useState } from "react";
import Link from "next/link";
import { ReportToolbar, ParentNoteEditor } from "./ReportToolbar";
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

/**
 * Dues keep their cents when they have any. A team-total split can make the
 * standard $3,428.57, and rounding that to $3,429 would state more than most
 * families owe.
 */
const duesAmount = (n) =>
  n == null ? "—" : Number.isInteger(Number(n)) ? dollars(n) : money(n);

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

/** Report detail levels. Display only: both come from the same records. */
export const DETAIL = { summary: "summary", detailed: "detailed" };

export function SeasonBudgetReport({ report, detail = null, initialDetail = DETAIL.summary, from = null, initialNote = "" }) {
  // Back returns to where the coach came from: Finance when launched from its
  // button (?from=finance), Reports otherwise. Never browser-history guesses.
  const backHref = from === "finance" ? "/finance" : "/reports";
  const backLabel = from === "finance" ? "Finance" : "Reports";
  // Session only: never saved. initialNote exists for previews and tests.
  const [note, setNote] = useState(initialNote);
  const [detailLevel, setDetailLevel] = useState(
    initialDetail === DETAIL.detailed && detail ? DETAIL.detailed : DETAIL.summary
  );
  const showDetailed = detailLevel === DETAIL.detailed && Boolean(detail);

  /**
   * The choice lives only in this page's address (?detail=detailed), keeping
   * ?from=finance. The document title — the PDF file name — follows it.
   * Nothing is saved.
   */
  function choose(next) {
    setDetailLevel(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === DETAIL.detailed) url.searchParams.set("detail", "detailed");
    else url.searchParams.delete("detail");
    window.history.replaceState(null, "", url);
    document.title = next === DETAIL.detailed
      ? document.title.replace("Planned Season Budget", "Season Budget Detail")
      : document.title.replace("Season Budget Detail", "Planned Season Budget");
  }

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
            <Link href={backHref}>← Back to {backLabel}</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rpt-shell">
      {/* Screen only. Never printed. */}
      <ReportToolbar
        name={showDetailed ? "Season Budget Detail" : "Planned Season Budget"}
        backHref={backHref}
        backLabel={backLabel}
        notes={[
          ...notices.map((w) => ({ title: w.title, message: w.message, action: Boolean(w.action) })),
          ...(showDetailed ? detailNotes(detail.coach) : []),
        ]}
        controls={detail && (
          <>
            <div className="rpt-detail" role="group" aria-label="Report detail">
              <span className="rpt-detail-label">Report detail</span>
              <span className="rpt-seg">
                {[[DETAIL.summary, "Summary"], [DETAIL.detailed, "Detailed"]].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`rpt-seg-btn${detailLevel === key ? " on" : ""}`}
                    aria-pressed={detailLevel === key}
                    onClick={() => choose(key)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
            {/* Always visible while Detailed is selected. Not a report note:
                it is the one thing a coach must not miss before sharing. */}
            {showDetailed && (
              <p className="rpt-privacy" role="note">
                Detailed shows each expense&rsquo;s date, description and amount to families.
                Descriptions print exactly as entered in Finance. Review them before sharing.
              </p>
            )}
          </>
        )}
      >
        <ParentNoteEditor note={note} setNote={setNote} />
      </ReportToolbar>

      {/* The document: exactly what prints for the selected detail level. */}
      {showDetailed
        ? <DetailArticle report={report} detail={detail} note={note} />
        : <SummaryArticle report={report} note={note} />}
    </div>
  );
}

/** The Summary document — the Planned Season Budget, unchanged. */
function SummaryArticle({ report, note }) {
  const { organization, team, season, allocation, dues, otherIncome } = report;
  const generated = fmtDate(report.generatedAt);
  return (
    <article className="rpt-page">
      <header className="rpt-head">
        <div className="rpt-head-row">
          {/* Team first, organization second — the same on every report. */}
          <div className="rpt-head-identity">
            <p className="rpt-org">{team.name ?? organization.name}</p>
            {team.name && organization.name && team.name !== organization.name && (
              <p className="rpt-team">{organization.name}</p>
            )}
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
          {season.name} season{generated ? ` · Updated ${generated}` : ""}
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

          {/* The team's standard dues, stated the same way for every team
              (2026-11). No range, no roster count, no total: any of those
              would let a family work out that someone pays a different
              amount. Individual arrangements stay in Player Dues. */}
          <p className="rpt-card-figure">{duesAmount(dues.perPlayer)}</p>
          <p className="rpt-card-label">per player</p>
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
      <footer className="rpt-foot rpt-foot-note">
        Budget amounts reflect the team&rsquo;s current season plan and may change as the
        season develops.
      </footer>
    </article>
  );
}

/** Coach-only report notes for Detailed. Never printed; no description text. */
function detailNotes(coach) {
  const notes = [];
  if (coach.nameMatches.length > 0) {
    notes.push({
      title: "Check these descriptions",
      message:
        `${coach.nameMatches.length === 1 ? "One description" : `${coach.nameMatches.length} descriptions`} may mention someone in your organization: ` +
        coach.nameMatches.map((m) => `${shortDate(m.date) ?? "no date"} · ${money(m.amount)}`).join("; ") +
        ". This is a check, not a guarantee — it can't catch every name.",
      action: true,
    });
  }
  if (coach.omittedNoAmount > 0) {
    notes.push({
      title: "Transactions without an amount",
      message: `${coach.omittedNoAmount} ${coach.omittedNoAmount === 1 ? "transaction has" : "transactions have"} no amount yet and ${coach.omittedNoAmount === 1 ? "isn't" : "aren't"} shown.`,
    });
  }
  if (coach.fullyCoveredUncategorized > 0) {
    const n = coach.fullyCoveredUncategorized;
    notes.push({
      title: "Tournaments without a budget category",
      message: `${n} committed ${n === 1 ? "tournament has" : "tournaments have"} no budget category. ${n === 1 ? "Its cost is" : "Their costs are"} already counted where the payments are recorded. Assign a category in Finance to keep the budget organized.`,
      action: true,
    });
  }
  return notes;
}

/* ------------------------------------------------------------------ */
/* Season Budget Detail                                                */
/* ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sep 1, 2026" from a YYYY-MM-DD date, without time-zone drift. */
function shortDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
function dateRange(start, end) {
  if (!start) return null;
  if (!end || end === start) return shortDate(start);
  const [y1, m1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  if (y1 === y2 && m1 === m2) return `${MONTHS[m1 - 1]} ${Number(start.slice(8, 10))}–${d2}, ${y2}`;
  return `${shortDate(start)} – ${shortDate(end)}`;
}

/** Remaining is Budget − Committed; a negative one reads as "Over budget". */
function RemainingValue({ value }) {
  return value < 0
    ? <span className="bd-over">Over budget {money(Math.abs(value))}</span>
    : <>{money(value)}</>;
}

function DetailRow({ r }) {
  const when = r.kind === "tournament" ? dateRange(r.startDate, r.endDate) : r.kind === "expense" ? shortDate(r.date) : null;
  const what = r.kind === "tournament" ? r.name : r.kind === "expense" ? r.description : r.label;
  return (
    <tr className={`bd-row bd-row-${r.kind}`}>
      <td className="bd-c-date">{when ?? "—"}</td>
      <td className="bd-c-item">
        {what}
        {r.kind === "tournament" && <span className="bd-tag"> · Tournament</span>}
      </td>
      <td className="rpt-num bd-c-amt">{money(r.amount)}</td>
      <td className="bd-c-status">{r.status}</td>
    </tr>
  );
}

/** The Detailed document: Season Budget Detail, "As of" the generation date. */
function DetailArticle({ report, detail, note }) {
  const { organization, team, season, dues, otherIncome } = report;
  const asOf = fmtDate(report.generatedAt);
  const s = detail.season;

  return (
    <article className="rpt-page bd-page">
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
        <h1 className="rpt-doc-title">Season Budget Detail</h1>
        <p className="rpt-doc-meta">
          {season.name} season{asOf ? ` · As of ${asOf}` : ""}
        </p>
      </header>

      <section className="rpt-section bd-season">
        <dl className="bd-figures">
          <div><dt>Budget</dt><dd>{money(s.budget)}</dd></div>
          <div><dt>Paid</dt><dd>{money(s.paid)}</dd></div>
          <div><dt>To Pay</dt><dd>{money(s.toPay)}</dd></div>
          <div><dt>Remaining</dt><dd><RemainingValue value={s.remaining} /></dd></div>
        </dl>
        <p className="bd-season-note">
          Committed {money(s.committed)}
          {s.percentCommitted != null ? ` (${s.percentCommitted}% of budget)` : ""}. Remaining is the budget not
          yet committed.
        </p>
        {s.unassignedTotal > 0 && (
          <p className="bd-season-note">
            After {money(s.unassignedTotal)} in committed tournaments not yet in a budget category:{" "}
            {s.projectedRemaining < 0
              ? <strong className="bd-over">over budget {money(Math.abs(s.projectedRemaining))}</strong>
              : <strong>{money(s.projectedRemaining)} remaining</strong>}.
          </p>
        )}
      </section>

      {/* bd-flow: unlike the Summary's short sections, this one may run over
          several pages, between whole categories and rows. */}
      <section className="rpt-section bd-flow">
        <p className="rpt-h">Spending by category</p>
        {detail.categories.length === 0 && <p className="bd-empty">No budget categories yet.</p>}
        {detail.categories.map((c) => (
          <table key={c.category} className={`bd-cat${c.rows.length <= 6 ? " bd-cat-short" : ""}`}>
            <colgroup>
              <col className="bd-col-date" /><col /><col className="bd-col-amt" /><col className="bd-col-status" />
            </colgroup>
            <thead>
              <tr className="bd-cat-head">
                <th colSpan={4}>
                  <span className="bd-cat-name">{c.category}</span>
                  <span className="bd-cat-figs">
                    <span>Budget {money(c.budget)}</span>
                    <span>Paid {money(c.paid)}</span>
                    <span>To Pay {money(c.toPay)}</span>
                    <span>Remaining <RemainingValue value={c.remaining} /></span>
                  </span>
                </th>
              </tr>
              {c.rows.length > 0 && (
                <tr className="bd-cols">
                  <th className="bd-c-date">Date</th>
                  <th className="bd-c-item">Item</th>
                  <th className="rpt-num bd-c-amt">Amount</th>
                  <th className="bd-c-status">Status</th>
                </tr>
              )}
            </thead>
            <tbody>
              {c.rows.length === 0
                ? <tr className="bd-row"><td colSpan={4} className="bd-none">No spending recorded yet.</td></tr>
                : c.rows.map((r, i) => <DetailRow key={i} r={r} />)}
            </tbody>
          </table>
        ))}
      </section>

      {detail.unassigned.length > 0 && (
        <section className="rpt-section bd-flow bd-unassigned">
          <p className="rpt-h">Committed tournaments not yet in a budget category</p>
          <table className={`bd-cat${detail.unassigned.length <= 6 ? " bd-cat-short" : ""}`}>
            <colgroup>
              <col className="bd-col-date" /><col /><col className="bd-col-amt" /><col className="bd-col-status" />
            </colgroup>
            <thead>
              <tr className="bd-cols">
                <th className="bd-c-date">Dates</th>
                <th className="bd-c-item">Tournament</th>
                <th className="rpt-num bd-c-amt">Amount</th>
                <th className="bd-c-status" />
              </tr>
            </thead>
            <tbody>
              {detail.unassigned.map((u, i) => (
                <tr key={i} className="bd-row">
                  <td className="bd-c-date">{dateRange(u.startDate, u.endDate) ?? "—"}</td>
                  <td className="bd-c-item">{u.name}</td>
                  <td className="rpt-num bd-c-amt">{money(u.amount)}</td>
                  <td className="bd-c-status" />
                </tr>
              ))}
              <tr className="bd-row bd-total">
                <td />
                <td className="bd-c-item">Total</td>
                <td className="rpt-num bd-c-amt">{money(s.unassignedTotal)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <div className="rpt-cards">
        <section className="rpt-card">
          <p className="rpt-h">Player dues</p>
          <p className="rpt-card-figure">{duesAmount(dues.perPlayer)}</p>
          <p className="rpt-card-label">per player</p>
        </section>
        {otherIncome.total > 0 && (
          <section className="rpt-card">
            <p className="rpt-h">Fundraising &amp; sponsorship</p>
            <p className="rpt-card-figure">{dollars(otherIncome.total)}</p>
            <p className="rpt-card-label">Planned this season</p>
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

      <footer className="rpt-foot rpt-foot-note">
        Budget amounts reflect the team&rsquo;s current season plan and may change as the
        season develops.
      </footer>
    </article>
  );
}
