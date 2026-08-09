"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * Opens a drawer from ?open=<id>, and clears the parameter when it closes.
 *
 * `open` always identifies the DESTINATION record — for a player payment that
 * is the player_payments id, not the player id.
 *
 * A record that isn't in `rows` simply doesn't open. That covers an id that is
 * stale, belongs to another season, or is one RLS never returned — a shared
 * link degrades to the normal page rather than erroring or hinting that the
 * record exists.
 */
export function useOpenParam(rows, setDetail) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("open");

  useEffect(() => {
    if (!openId) return;
    const match = (rows ?? []).find((r) => r.id === openId);
    if (match) setDetail(match);
    // No match: leave the page as it is. Deliberately silent.
  }, [openId, rows, setDetail]);

  /**
   * Clears ?open without adding a history entry, so Back returns to wherever
   * the coach came from rather than reopening the drawer.
   */
  function clearOpenParam() {
    if (!openId) return;
    const next = new URLSearchParams(params.toString());
    next.delete("open");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return { clearOpenParam };
}
