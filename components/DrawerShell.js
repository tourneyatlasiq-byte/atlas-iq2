"use client";

import { useEffect, useRef } from "react";

/**
 * The drawer shell every detail panel sits in.
 *
 * There is one behavioural reason this exists rather than being five copies of
 * the same twelve lines: CLOSING ON A PLAIN BACKDROP CLICK IS WRONG.
 *
 * A browser fires `click` on the nearest common ancestor of `mousedown` and
 * `mouseup`. Drag-select an email inside a drawer and release a few pixels
 * outside the input — over the backdrop, which covers the viewport — and the
 * click fires on the BACKDROP. `stopPropagation` on the drawer never runs, and
 * the panel closes mid-selection. A coach reported exactly this while editing a
 * guardian's email; it was fixed in the player drawer and left broken in the
 * other five, because the fix lived in the component rather than in the shell.
 *
 * Recording where the press STARTED separates the two cases: an intentional
 * click on the backdrop still closes, a drag that merely ends there does not.
 *
 * What this owns: the backdrop and the press-origin guard. Escape and the body
 * lock are OPT-IN, because every page here already handles them for all its
 * overlays with precedence. What it deliberately does NOT own: anything inside.
 * A tournament and a player have nothing in common below the shell, and forcing
 * their content into a shared layout is where a design system starts fighting
 * the product.
 */
export function DrawerShell({
  onClose,
  labelledBy,
  ariaLabel,
  className = "",
  // OFF BY DEFAULT, deliberately. Every page that owns a drawer already has an
  // effect handling Escape and the body lock for ALL its overlays, with
  // precedence — a modal stacked over a drawer must take Escape first. A shell
  // that also handled them would double-lock the body (two effects restoring
  // each other's saved value) and close the drawer underneath an open modal.
  // The shell owns the backdrop; the page keeps the keyboard and the lock
  // until a page has reason to hand them over.
  closeOnEscape = false,
  lockScroll = false,
  children,
}) {
  const pressOnBackdrop = useRef(false);

  useEffect(() => {
    if (!closeOnEscape) return undefined;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, closeOnEscape]);

  useEffect(() => {
    if (!lockScroll) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [lockScroll]);

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => { pressOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressOnBackdrop.current) onClose?.();
        pressOnBackdrop.current = false;
      }}
    >
      {/* No onClick stopPropagation here. It was the workaround the press-origin
          guard replaces, and leaving it would swallow clicks the drawer's own
          content sometimes wants to see. */}
      <aside
        className={`drawer${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
        {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      >
        {children}
      </aside>
    </div>
  );
}

/**
 * A titled section inside a drawer.
 *
 * Three components had their own copy of this and four had their own Row, all
 * emitting identical markup. Facilities' version was the superset — it also
 * supports a right-aligned action and an anchor id — so that is the one kept.
 * Nothing about the rendered output changes.
 */
export function DrawerSection({ title, children, action, anchor, className }) {
  return (
    <section
      className={`detail-section${className ? ` ${className}` : ""}`}
      id={anchor ? `section-${anchor}` : undefined}
    >
      {action ? (
        <div className="detail-section-head">
          <h3 className="detail-section-title">{title}</h3>
          {action}
        </div>
      ) : (
        <h3 className="detail-section-title">{title}</h3>
      )}
      {children}
    </section>
  );
}

/** A label/value pair. An empty value reads as an em dash, never as a gap. */
export function DrawerRow({ label, value }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="detail-row">
      <span className="detail-row-label">{label}</span>
      <span className="detail-row-value">{empty ? <span className="muted">—</span> : value}</span>
    </div>
  );
}
