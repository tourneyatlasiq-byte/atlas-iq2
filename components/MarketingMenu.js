"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Phone navigation for the public site. Below 760px the inline links are
 * hidden, so this is the only way to reach Product, Quality at-bats, About and
 * Sign in. A real button with aria-expanded, Escape to close, focus returned
 * to the button, and the panel closes when a link is chosen.
 */
export default function MarketingMenu({ links, signedIn, appHref }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { setOpen(false); btn.current?.focus(); }
      if (e.key === "Tab" && panel.current) {
        const items = [btn.current, ...panel.current.querySelectorAll("a")];
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="sx-menu">
      <button
        ref={btn}
        type="button"
        className="sx-menu-btn"
        aria-expanded={open}
        aria-controls="sx-menu-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <nav id="sx-menu-panel" ref={panel} className="sx-menu-panel" aria-label="Menu">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</Link>
          ))}
          {signedIn
            ? <Link href={appHref} onClick={() => setOpen(false)}>Open Season Tempo</Link>
            : (
              <>
                <Link href="/login" onClick={() => setOpen(false)}>Sign in</Link>
                <Link href="/login?new=1" className="sx-menu-go" onClick={() => setOpen(false)}>Get started</Link>
              </>
            )}
        </nav>
      )}
    </div>
  );
}
