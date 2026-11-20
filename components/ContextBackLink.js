"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { backTarget } from "../lib/game-flow-rules";
import { claimEntry, markBackTap } from "../lib/back-context";

/**
 * Back link that returns to where the coach came from (2026-11). When the page
 * was opened from Home, "from=home" names it: the link reads "Home" and is a
 * normal link to Home, always. It never uses browser history, so it cannot
 * dead-end on a duplicate entry (Save Lineup adds one) or leave Season Tempo.
 * When the page really was entered from Home, tapping it also asks Home to put
 * its scroll position back. With no (or an unknown) from, it is the usual fixed
 * link. Never follows an arbitrary address: only the names in BACK_TARGETS are
 * accepted.
 */
export function ContextBackLink({ from, fallbackHref, fallbackLabel, className = "back-link" }) {
  const target = backTarget(from);
  const [fromHome, setFromHome] = useState(false);
  const claimed = useRef(false);
  useEffect(() => {
    if (!target || claimed.current) return;
    claimed.current = true; // effects can run twice in development; claim once
    try {
      const here = window.location.pathname + window.location.search;
      const nav = performance.getEntriesByType?.("navigation")?.[0]?.type;
      setFromHome(claimEntry(window.sessionStorage, from, here, nav));
    } catch { /* normal link */ }
  }, [from, target]);

  if (!target) return <Link href={fallbackHref} className={className}>{fallbackLabel}</Link>;
  const onClick = () => { if (fromHome) { try { markBackTap(window.sessionStorage); } catch { /* ignore */ } } };
  return <Link href={target.href} className={className} onClick={onClick}>{`← ${target.label}`}</Link>;
}
