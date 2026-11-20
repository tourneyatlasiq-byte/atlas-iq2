"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { markEntry, saveScroll } from "../lib/back-context";

/**
 * A link that answers the tap at once (2026-11). On a slow phone connection a
 * game page can take a moment to open, and a button that does nothing
 * visible invites a second tap. This one shows a pressed state through the
 * .btn :active rule, swaps its label to "Opening..." and ignores repeat taps
 * until the page changes. If navigation never happens it resets itself.
 *
 * Presentation only: it renders a normal Next link and changes no route.
 * Modified clicks (new tab, new window) are left alone.
 */
export function GameLink({ href, className = "btn", children, busyLabel = "Opening...", markFrom = null, ...rest }) {
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
    if (busy) { e.preventDefault(); return; }
    if (markFrom) { try { markEntry(window.sessionStorage, markFrom, href); saveScroll(window.sessionStorage, window.scrollY); } catch { /* ignore */ } }
    setBusy(true);
    timer.current = setTimeout(() => setBusy(false), 8000);
  };

  return (
    <Link href={href} className={`${className}${busy ? " is-pending" : ""}`} aria-busy={busy || undefined} onClick={onClick} {...rest}>
      {busy ? busyLabel : children}
    </Link>
  );
}
