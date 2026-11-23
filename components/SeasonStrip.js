"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { statusWords } from "../lib/tournament-status";
import { fmtDateRange } from "../lib/dates";
import { localDateIso } from "../lib/local-date";

/**
 * The season tempo: every tournament of the selected season as a dot on one line.
 *
 * Compact by default so the tournament list stays near the top of the page; the
 * coach who likes the visual schedule expands it (the choice is remembered on
 * this device). Read-only: nothing here writes.
 *
 * Range: the season's own dates when it has both. Otherwise the tournaments'
 * own span, snapped to whole months, so the line never implies season dates
 * that were not entered.
 *
 * Dots: a mouse hovers for name, dates, place and status and clicks to open the
 * tournament. A finger taps for the same details with an Open button. Dots that
 * would touch merge into one numbered dot whose list opens on a click or tap, so
 * markers never overlap and nothing scrolls sideways.
 */
const DAY = 86400000;
const at = (s) => new Date(s + "T12:00:00");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STORE = "st.tempo.expanded";
const fmtRange = fmtDateRange;

/** The place a coach would recognise: the facility with its city, else the typed location. */
function placeOf(t) {
  const f = t.facility;
  if (f?.name) return [f.name, [f.city, f.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  return t.location ?? "";
}

/** Decision, registration and payment, from the one shared mapping. */
function statusOf(t, transactions) {
  return statusWords(t, transactions);
}

/**
 * Merge dots closer than `gap` pixels. A cluster is anchored at its first dot,
 * so a long chain of near dates cannot swallow the whole line.
 */
export function clusterBeats(items, gap) {
  let groups = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && it.x - last.anchor < gap) { last.items.push(it); continue; }
    groups.push({ anchor: it.x, items: [it] });
  }
  const center = (g) => g.items.reduce((s, i) => s + i.x, 0) / g.items.length;
  // A merged dot sits at its average, which can land next to its neighbour: merge again until no two touch.
  for (let again = true; again;) {
    again = false;
    for (let i = 1; i < groups.length; i++) {
      if (center(groups[i]) - center(groups[i - 1]) < gap) {
        groups[i - 1].items.push(...groups[i].items);
        groups.splice(i, 1);
        again = true;
        break;
      }
    }
  }
  return groups.map((g) => ({
    key: g.items.map((i) => i.t.id).join("|"),
    x: center(g),
    items: g.items.map((i) => i.t),
  }));
}

/** Whole-month range for a set of tournaments (no season dates). */
export function monthRange(beats, today) {
  if (!beats.length) {
    const t = at(today);
    return { a: new Date(t.getFullYear(), t.getMonth() - 1, 1, 12), b: new Date(t.getFullYear(), t.getMonth() + 8, 1, 12) };
  }
  const first = at(beats[0].start_date);
  const last = beats.reduce((m, t) => { const e = at(t.end_date ?? t.start_date); return e > m ? e : m; }, at(beats[0].end_date ?? beats[0].start_date));
  let a = new Date(first.getFullYear(), first.getMonth(), 1, 12);
  const td = at(today);
  // Keep today on the line when the next tournament is not far off.
  if (td < first && first - td <= 60 * DAY) a = new Date(td.getFullYear(), td.getMonth(), 1, 12);
  let b = new Date(last.getFullYear(), last.getMonth() + 1, 1, 12);
  const minEnd = new Date(a.getFullYear(), a.getMonth() + 3, 1, 12);
  if (b < minEnd) b = minEnd;
  return { a, b };
}

export function SeasonStrip({ season, tournaments = [], transactions = [], nextId = null, today = localDateIso(), onOpen = null }) {
  const [expanded, setExpanded] = useState(false);
  const [sel, setSel] = useState(null);      // pinned cluster key
  const [hover, setHover] = useState(null);  // hovered cluster key
  const [width, setWidth] = useState(640);
  const [canHover, setCanHover] = useState(false);
  const trackRef = useRef(null);

  useEffect(() => {
    try { setExpanded(localStorage.getItem(STORE) === "1"); } catch { /* the default is fine */ }
    try {
      const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
      setCanHover(mq.matches);
      const on = () => setCanHover(mq.matches);
      mq.addEventListener?.("change", on);
      return () => mq.removeEventListener?.("change", on);
    } catch { /* touch behaviour is the safe default */ }
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const read = () => setWidth(Math.max(120, el.clientWidth));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function toggle() {
    const v = !expanded;
    setExpanded(v);
    setSel(null);
    try { localStorage.setItem(STORE, v ? "1" : "0"); } catch { /* not remembered; still works */ }
  }

  const beats = useMemo(
    () => (tournaments ?? []).filter((t) => t.start_date && t.decision !== "Declined").sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [tournaments]
  );

  const range = useMemo(() => {
    if (season?.start_date && season?.end_date && season.end_date > season.start_date) {
      return { a: at(season.start_date), b: at(season.end_date) };
    }
    return monthRange(beats, today);
  }, [season, beats, today]);

  const span = Math.max(DAY, range.b - range.a);
  const pct = (s) => Math.min(100, Math.max(0, ((at(s) - range.a) / span) * 100));

  const months = useMemo(() => {
    const out = [];
    const d = new Date(range.a.getFullYear(), range.a.getMonth(), 1, 12);
    while (d <= range.b) {
      const p = ((d - range.a) / span) * 100;
      out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MON[d.getMonth()], year: String(d.getFullYear()).slice(2), jan: d.getMonth() === 0, p: Math.max(0, p) });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [range, span]);
  const perMonth = width / Math.max(1, months.length);

  const GAP = canHover ? 22 : 32;
  const clusters = useMemo(
    () => clusterBeats(beats.map((t) => ({ t, x: (pct(t.start_date) / 100) * width })), GAP),
    [beats, width, GAP, range] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const committed = beats.filter((t) => t.decision === "Committed");
  const next = beats.find((t) => t.id === nextId) ?? null;
  const nextIndex = next ? committed.indexOf(next) + 1 : 0;
  const daysTo = next ? Math.round((at(next.start_date) - at(today)) / DAY) : null;
  const todayIn = today >= range.a.toISOString().slice(0, 10) && today <= range.b.toISOString().slice(0, 10);
  const pinned = clusters.find((c) => c.key === sel) ?? null;
  const hovered = !pinned ? clusters.find((c) => c.key === hover) ?? null : null;

  const kind = (t) => {
    if ((t.end_date ?? t.start_date) < today) return "played";
    if (t.id === nextId) return "next";
    if (t.decision === "Considering") return "maybe";
    if (t.paid_status === "Waitlisted") return "wait";
    if (t.paid_status === "Not Registered") return "unreg";
    return "ready";
  };

  const open = (t) => { setSel(null); setHover(null); onOpen?.(t); };

  function press(c) {
    // A mouse click on one dot opens it; a tap, or a numbered dot, shows the details first.
    if (canHover && c.items.length === 1 && onOpen) { open(c.items[0]); return; }
    setSel(sel === c.key ? null : c.key);
  }

  const tipLeft = (x) => `${Math.min(Math.max(x, 130), Math.max(130, width - 130))}px`;
  const idle = !pinned;

  return (
    <section className={`st-tempo card${expanded ? " is-expanded" : ""}`} aria-label={`${season?.name ?? "Season"} tempo`}>
      <div className="st-tempo-h">
        <div className="st-tempo-title">
          <b>{beats.length === 0 ? `${season?.name ?? "Season"} tempo` : next ? `Tournament ${nextIndex} of ${committed.length}` : `${season?.name ?? "Season"}`}</b>
          <span>
            {beats.length === 0
              ? "Each tournament you add becomes a dot on this line."
              : next
                ? daysTo <= 0 ? `${next.name} is on now` : `${daysTo} ${daysTo === 1 ? "day" : "days"} to ${next.name}`
                : "No committed tournaments ahead"}
          </span>
        </div>
        {beats.length > 0 && (
          <button type="button" className="st-tempo-toggle" aria-expanded={expanded} aria-controls="st-tempo-body" onClick={toggle}>
            {expanded ? "Compact" : "Expand"}
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d={expanded ? "M6 14l6-6 6 6" : "M6 10l6 6 6-6"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>

      <div id="st-tempo-body">
        <div className="st-track-wrap" ref={trackRef} onKeyDown={(e) => { if (e.key === "Escape") { setSel(null); setHover(null); } }}>
          <div className="st-track">
            <span className="st-track-line" aria-hidden="true" />
            {todayIn && <span className="st-track-done" style={{ width: `${pct(today)}%` }} aria-hidden="true" />}
            {todayIn && <span className="st-today" style={{ left: `${pct(today)}%` }} aria-hidden="true">{expanded && <span>Today</span>}</span>}
            {clusters.map((c) => {
              const one = c.items.length === 1;
              const k = one ? kind(c.items[0]) : c.items.some((t) => t.id === nextId) ? "next" : "group";
              const label = one
                ? `${c.items[0].name}, ${fmtRange(c.items[0].start_date, c.items[0].end_date)}, ${statusOf(c.items[0], transactions)}`
                : `${c.items.length} tournaments from ${fmtRange(c.items[0].start_date, c.items[0].start_date)} to ${fmtRange(c.items[c.items.length - 1].start_date, c.items[c.items.length - 1].start_date)}`;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`st-beat is-${k}${one ? "" : " is-cluster"}${sel === c.key ? " is-on" : ""}`}
                  style={{ left: `${(c.x / width) * 100}%` }}
                  aria-label={label}
                  aria-expanded={sel === c.key}
                  aria-controls="st-tempo-callout"
                  onClick={() => press(c)}
                  onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(c.key); }}
                  onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}
                  onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) setHover(c.key); }}
                  onBlur={() => setHover(null)}
                >
                  {!one && <span className="st-cluster-n" aria-hidden="true">{c.items.length}</span>}
                </button>
              );
            })}
          </div>

          {hovered && idle && (
            <div className="st-tip" role="tooltip" style={{ left: tipLeft(hovered.x) }}>
              {hovered.items.slice(0, 4).map((t) => (
                <div key={t.id} className="st-tip-row">
                  <b>{t.name}</b>
                  <span>{fmtRange(t.start_date, t.end_date)}{placeOf(t) ? ` · ${placeOf(t)}` : ""}</span>
                  <span className="st-tip-status">{statusOf(t, transactions)}</span>
                </div>
              ))}
              {hovered.items.length > 4 && <span className="st-tip-more">+{hovered.items.length - 4} more</span>}
              <span className="st-tip-hint">{hovered.items.length === 1 && onOpen ? "Click to open" : "Click for the list"}</span>
            </div>
          )}

          <div className="st-months" aria-hidden="true">
            {months.map((m, i) => {
              if (i % 2 && perMonth < 34) return null;
              return <span key={m.key} style={{ left: `${m.p}%` }}>{m.label}{(m.jan || i === 0) && perMonth >= 46 ? ` ’${m.year}` : ""}</span>;
            })}
          </div>
        </div>

        {pinned ? (
          <div className="st-callout" id="st-tempo-callout" role="region" aria-live="polite">
            <ul className="st-callout-list">
              {pinned.items.map((t) => (
                <li key={t.id}>
                  <div>
                    <b>{t.name}</b>
                    <span>{fmtRange(t.start_date, t.end_date)}{placeOf(t) ? ` · ${placeOf(t)}` : ""}</span>
                    <span>{statusOf(t, transactions)}</span>
                  </div>
                  {onOpen
                    ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => open(t)}>Open</button>
                    : <Link className="btn btn-secondary btn-sm" href={`/tournaments?open=${t.id}`}>Open</Link>}
                </li>
              ))}
            </ul>
            <button type="button" className="st-callout-x" aria-label="Close" onClick={() => setSel(null)}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
            </button>
          </div>
        ) : (
          expanded && beats.length > 0 && (
            <div className="st-key" aria-hidden="true">
              <span><i className="is-played" />Played</span><span><i className="is-next" />Next up</span><span><i className="is-ready" />Registered</span>
              <span><i className="is-unreg" />Not registered</span><span><i className="is-wait" />Waitlisted</span><span><i className="is-maybe" />Considering</span>
              <span><i className="is-group">2</i>Several close together</span>
            </div>
          )
        )}
      </div>
    </section>
  );
}
