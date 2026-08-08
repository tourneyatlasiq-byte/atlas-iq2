"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { viewSeason } from "../lib/actions/seasons";

/**
 * Season selector in the context header.
 *
 * Changes only what this user is looking at. Advancing the team into a season
 * is a separate, admin-only action in Settings — a coach checking last year's
 * schedule should not be able to move everyone else's season by accident.
 */
export function SeasonPicker({ seasons, season, phase }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function away(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function key(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // Nothing to choose between.
  if (!seasons || seasons.length <= 1) {
    return <span className="crumb crumb-season">{season?.name ?? "None"}</span>;
  }

  const label = (s) =>
    s.is_current ? "Current" : phaseFor(s) === "future" ? "Planning" : "Past";

  function phaseFor(s) {
    const current = seasons.find((x) => x.is_current);
    if (s.is_current) return "current";
    if (!current) return "current";
    const key = (x) => x.start_date ?? x.created_at?.slice(0, 10) ?? "";
    return key(s) > key(current) ? "future" : "past";
  }

  return (
    <span className="crumb-picker" ref={ref}>
      <button className="season-trigger" onClick={() => setOpen(!open)} aria-expanded={open}>
        <strong>{season?.name ?? "None"}</strong>
        {phase !== "current" && (
          <span className="season-chip-phase">{phase === "past" ? "Past" : "Planning"}</span>
        )}
        <span aria-hidden="true" className="season-caret">▾</span>
      </button>

      {open && (
        <div className="season-menu" role="menu">
          {seasons.map((s) => (
            <button
              key={s.id}
              className={`season-option${s.id === season?.id ? " on" : ""}`}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await viewSeason(s.id);
                  setOpen(false);
                })
              }
            >
              <span>{s.name}</span>
              <span className={`season-option-tag tag-${phaseFor(s)}`}>{label(s)}</span>
            </button>
          ))}
          <p className="season-menu-note">
            Changes what you're looking at. It doesn't change the season for anyone else.
          </p>
        </div>
      )}
    </span>
  );
}
