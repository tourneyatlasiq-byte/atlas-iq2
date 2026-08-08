"use client";

import { useState, useEffect, useRef } from "react";
import { TERMS } from "../lib/onboarding";

/**
 * One-sentence explanation for a term a first-time user may not recognise.
 *
 * Click or tap to open, not hover — hover doesn't exist on a phone, and a
 * coach checking something at a tournament is on a phone.
 */
export function HelpTip({ term, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onAway(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const text = TERMS[term];
  if (!text) return null;

  return (
    <span className="helptip" ref={ref}>
      <button
        type="button"
        className="helptip-btn"
        aria-label={`What does ${term} mean?`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        ?
      </button>
      {open && (
        <span className="helptip-bubble" role="tooltip">
          <strong>{label ?? term}</strong>
          {text}
        </span>
      )}
    </span>
  );
}
