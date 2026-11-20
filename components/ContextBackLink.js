"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { backTarget } from "../lib/game-flow-rules";
import { cameFromApp } from "../lib/back-context";

/**
 * Back link that returns to where the coach came from (2026-11). When the page
 * was opened from Home, "from=home" names it: the link reads "Home" and goes
 * back in history when Home really was the previous page in this app, so Home
 * reappears at the same scroll position; a direct-link entry goes to Home as a
 * normal link instead. With no (or an unknown) from, it is the usual fixed link. Never
 * follows an arbitrary address: only the names in BACK_TARGETS are accepted.
 */
export function ContextBackLink({ from, fallbackHref, fallbackLabel, className = "back-link" }) {
  const router = useRouter();
  const target = backTarget(from);
  if (!target) return <Link href={fallbackHref} className={className}>{fallbackLabel}</Link>;

  const onClick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
    // History Back only when the previous entry is Home in this app (it
    // restores Home where it was). A direct link falls through to the normal
    // link to Home, so Back can never lead outside Season Tempo.
    try {
      const here = window.location.pathname + window.location.search;
      if (cameFromApp(window.sessionStorage, from, here)) {
        e.preventDefault();
        router.back();
      }
    } catch { /* normal link */ }
  };
  return <Link href={target.href} className={className} onClick={onClick}>{`← ${target.label}`}</Link>;
}
