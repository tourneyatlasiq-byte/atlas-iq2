"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { HOW_DO_I } from "../lib/onboarding";

/** Global "How do I…?" menu. Short answers, direct links, no help centre. */
export function HelpMenu() {
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

  return (
    <div className="help-menu" ref={ref}>
      <button
        className="help-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        How do I…?
      </button>

      {open && (
        <div className="help-panel" role="menu">
          <p className="help-panel-title">Common questions</p>
          <ul>
            {HOW_DO_I.map((item) => (
              <li key={item.q}>
                {item.href ? (
                  <Link href={item.href} className="help-item" onClick={() => setOpen(false)}>
                    <span className="help-q">{item.q}</span>
                    <span className="help-a">{item.a}</span>
                  </Link>
                ) : (
                  <span className="help-item help-item-disabled">
                    <span className="help-q">{item.q}</span>
                    <span className="help-a">{item.a}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
