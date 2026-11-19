"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A "More actions" menu for rarely used or risky actions (Delete first of all),
 * so the footer keeps room for the one action that matters.
 *
 * items: [{ label, onSelect, danger?, disabled?, description? }]. A description
 * is a short line under the label for actions whose effects differ. Selecting an item closes
 * the menu and calls onSelect; anything destructive still goes through the
 * caller's own confirmation. Escape or a tap outside closes it and focus goes
 * back to the button. Shared by the tournament drawer and, next, the Finance
 * drawers.
 */
export function MoreActionsMenu({ items, label = "More actions", disabled = false }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); button.current?.focus(); }
    };
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  if (!items || items.length === 0) return null;
  return (
    <div className="more-menu" ref={wrap}>
      <button ref={button} type="button" className="more-menu-btn" aria-label={label} aria-haspopup="menu"
        aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="4" cy="10" r="1.7" fill="currentColor" /><circle cx="10" cy="10" r="1.7" fill="currentColor" /><circle cx="16" cy="10" r="1.7" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="more-menu-list" role="menu" aria-label={label}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled}
              className={`more-menu-item${it.danger ? " is-danger" : ""}`}
              onClick={() => { setOpen(false); it.onSelect?.(); }}>
              <span className="more-menu-label">{it.label}</span>
              {it.description && <span className="more-menu-desc">{it.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
