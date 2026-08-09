"use client";

import { useCallback, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * Drawer state lives in the URL. One pattern across Atlas.
 *
 * `?open=<id>` always identifies the DESTINATION record — for a player payment
 * that is the player_payments id, not the player id.
 *
 * There is deliberately no local mirror of this state. Two sources for one
 * thing is how a drawer ends up open in the URL and closed on screen.
 *
 *   row click            -> URL gains ?open
 *   cross-module link    -> arrives with ?open
 *   refresh              -> same drawer
 *   Back                 -> closes the drawer
 *   close                -> clears ?open, keeps tab/view/filter/season
 *
 * A record that isn't in `rows` simply doesn't open. That covers ids that are
 * stale, from another season, or blocked by RLS — a shared link degrades to the
 * normal page rather than erroring or hinting the record exists.
 */
export function useOpenParam(rows) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("open");

  const detail = useMemo(() => {
    if (!openId) return null;
    return (rows ?? []).find((r) => r?.id === openId) ?? null;
  }, [openId, rows]);

  /** Rebuilds the query string, touching only `open`. */
  const withOpen = useCallback(
    (id) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("open", id);
      else next.delete("open");
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname]
  );

  // push, so Back closes the drawer rather than leaving the page.
  const openDetail = useCallback(
    (row) => {
      if (!row?.id) return;
      router.push(withOpen(row.id), { scroll: false });
    },
    [router, withOpen]
  );

  // replace, so closing doesn't add a second history entry to step back through.
  const closeDetail = useCallback(() => {
    router.replace(withOpen(null), { scroll: false });
  }, [router, withOpen]);

  return { detail, openDetail, closeDetail };
}
