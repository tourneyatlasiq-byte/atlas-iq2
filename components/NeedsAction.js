"use client";

import { HelpTip } from "./HelpTip";

/**
 * Needs Action panel — shared across Atlas IQ modules.
 *
 * Knows nothing about players, tournaments or payments. It renders whatever
 * actions a module's readiness rules produce, and reports which one was
 * clicked so the module can filter its own list.
 *
 * Renders nothing when there are no actions. The absence of the panel means
 * nothing currently requires attention — there is deliberately no "all clear"
 * message.
 */
export function NeedsAction({ actions, activeId = null, onSelect, showWhenClear = false }) {
  // A section that vanishes leaves a coach unable to tell whether everything is
  // fine or the feature is broken. Where it matters, say so plainly.
  if (!actions || actions.length === 0) {
    if (!showWhenClear) return null;
    return (
      <div className="card action-band action-clear">
        <h2>Needs Action <HelpTip term="Needs Action" /></h2>
        <p className="action-clear-title">You're up to date</p>
        <p className="action-clear-sub">Nothing needs your attention right now.</p>
      </div>
    );
  }

  return (
    <div className="card action-band">
      <h2>Needs Action <HelpTip term="Needs Action" /></h2>
      <ul className="action-list">
        {actions.map((a) => {
          const on = activeId === a.id;
          return (
            <li key={a.id}>
              <button
                className={`action-row${on ? " on" : ""}`}
                onClick={() => onSelect?.(on ? null : a.id)}
                aria-pressed={on}
              >
                <span className={`action-dot${a.priority <= 20 ? " high" : ""}`} aria-hidden="true" />
                <span className="action-name">{a.title}</span>
                <span className="action-reason">{a.detail}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The "Showing 4 who need uniform information ×" chip. */
export function FilterChip({ label, onClear }) {
  if (!label) return null;
  return (
    <div className="filter-chip">
      <span>{label}</span>
      <button onClick={onClear} aria-label="Clear filter">✕</button>
    </div>
  );
}
