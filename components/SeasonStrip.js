"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { statusLine } from "../lib/tournament-status";
import { fmtDateRange } from "../lib/dates";
import { localDateIso } from "../lib/local-date";

/**
 * The season tempo: every tournament of the selected season as a beat on one line.
 *
 * The range comes from the season's own dates. A season without dates falls
 * back to its tournaments' dates, so a planning season still draws. Tapping a
 * beat shows its name, dates and status underneath (phones have no hover), with
 * a link into the tournament. Read-only: nothing here writes.
 */
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const at = (s) => new Date(s + "T12:00:00");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtRange = fmtDateRange;

export function SeasonStrip({ season, tournaments = [], transactions = [], nextId = null, today = localDateIso(), compact = false }) {
  const [sel, setSel] = useState(null);
  const beats = useMemo(
    () => (tournaments ?? []).filter((t) => t.start_date && t.decision !== "Declined").sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [tournaments]
  );

  const range = useMemo(() => {
    if (season?.start_date && season?.end_date && season.end_date > season.start_date) {
      return { a: at(season.start_date), b: at(season.end_date), fromSeason: true };
    }
    if (beats.length) {
      const first = at(beats[0].start_date), last = at(beats[beats.length - 1].end_date ?? beats[beats.length - 1].start_date);
      return { a: new Date(first - 14 * DAY), b: new Date(+last + 14 * DAY), fromSeason: false };
    }
    const t = at(today);
    return { a: new Date(t - 60 * DAY), b: new Date(+t + 240 * DAY), fromSeason: false };
  }, [season, beats, today]);

  const span = Math.max(DAY, range.b - range.a);
  const pos = (s) => Math.min(100, Math.max(0, ((at(s) - range.a) / span) * 100));

  const months = useMemo(() => {
    const out = [];
    const d = new Date(range.a.getFullYear(), range.a.getMonth(), 1, 12);
    while (d <= range.b) {
      const p = ((d - range.a) / span) * 100;
      if (p >= -2) out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MON[d.getMonth()], p: Math.max(0, p) });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [range, span]);

  const committed = beats.filter((t) => t.decision === "Committed");
  const next = beats.find((t) => t.id === nextId) ?? null;
  const nextIndex = next ? committed.indexOf(next) + 1 : 0;
  const daysTo = next ? Math.round((at(next.start_date) - at(today)) / DAY) : null;
  const todayIn = today >= iso(range.a) && today <= iso(range.b);
  const selected = beats.find((t) => t.id === sel) ?? null;

  const kind = (t) => {
    if ((t.end_date ?? t.start_date) < today) return "played";
    if (t.id === nextId) return "next";
    if (t.decision === "Considering") return "maybe";
    if (t.paid_status === "Waitlisted") return "wait";
    if (t.paid_status === "Not Registered") return "unreg";
    return "ready";
  };
  const KIND_LABEL = { played: "Played", next: "Next up", maybe: "Considering", wait: "Waitlisted", unreg: "Not registered", ready: "Registered" };

  return (
    <section className={`st-tempo card${compact ? " is-compact" : ""}`} aria-label={`${season?.name ?? "Season"} tempo`}>
      <div className="st-tempo-h">
        <b>{beats.length === 0 ? `${season?.name ?? "Season"} tempo` : next ? `Tournament ${nextIndex} of ${committed.length}` : `${season?.name ?? "Season"}`}</b>
        <span>
          {beats.length === 0
            ? "Each tournament you add becomes a beat on this line."
            : next
              ? daysTo <= 0 ? `${next.name} is on now` : `${daysTo} ${daysTo === 1 ? "day" : "days"} to ${next.name}`
              : "No committed tournaments ahead"}
        </span>
      </div>

      <div className="st-track" onKeyDown={(e) => { if (e.key === "Escape") setSel(null); }}>
        <span className="st-track-line" aria-hidden="true" />
        {todayIn && <span className="st-track-done" style={{ width: `${pos(today)}%` }} aria-hidden="true" />}
        {todayIn && <span className="st-today" style={{ left: `${pos(today)}%` }} aria-hidden="true"><span>Today</span></span>}
        {beats.map((t) => {
          const k = kind(t);
          return (
            <button
              key={t.id}
              type="button"
              className={`st-beat is-${k}${sel === t.id ? " is-on" : ""}`}
              style={{ left: `${pos(t.start_date)}%` }}
              aria-label={`${t.name}, ${fmtRange(t.start_date, t.end_date)}, ${KIND_LABEL[k]}`}
              aria-expanded={sel === t.id}
              aria-controls="st-tempo-callout"
              onClick={() => setSel(sel === t.id ? null : t.id)}
            />
          );
        })}
      </div>
      <div className="st-months" aria-hidden="true">
        {months.map((m, i) => (
          <span key={m.key} style={{ left: `${m.p}%` }} className={i % 2 ? "is-odd" : ""}>{m.label}</span>
        ))}
      </div>

      {selected ? (
        <div className="st-callout" id="st-tempo-callout" role="region" aria-live="polite">
          <div style={{ minWidth: 0 }}>
            <b>{selected.name}</b>
            <span>
              {fmtRange(selected.start_date, selected.end_date)} · {(() => { const s = statusLine(selected, transactions); return s.sub ? `${s.main}, ${s.sub}` : s.main; })()}
            </span>
          </div>
          {/* Tournaments a fortnight apart overlap on a phone-width line, so a tap
              can land on a neighbour. Stepping makes every tournament reachable. */}
          <span className="st-callout-step">
            <button type="button" aria-label="Previous tournament" disabled={beats.indexOf(selected) === 0} onClick={() => setSel(beats[beats.indexOf(selected) - 1].id)}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" aria-label="Next tournament" disabled={beats.indexOf(selected) === beats.length - 1} onClick={() => setSel(beats[beats.indexOf(selected) + 1].id)}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </span>
          <Link className="btn btn-secondary btn-sm" href={`/tournaments?open=${selected.id}`}>Open</Link>
          <button type="button" className="st-callout-x" aria-label="Close" onClick={() => setSel(null)}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          </button>
        </div>
      ) : (
        beats.length > 0 && (
          <div className="st-key" aria-hidden="true">
            <span><i className="is-played" />Played</span><span><i className="is-next" />Next up</span><span><i className="is-ready" />Registered</span>
            <span><i className="is-unreg" />Not registered</span><span><i className="is-wait" />Waitlisted</span><span><i className="is-maybe" />Considering</span>
          </div>
        )
      )}
      {!range.fromSeason && beats.length > 0 && <p className="st-tempo-note">This season has no start and end dates, so the line spans its tournaments.</p>}
    </section>
  );
}
