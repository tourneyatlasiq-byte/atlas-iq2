"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
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
/**
 * Opt-in history hygiene (Release 3, BACK-002): `{ ownEntry: true }`.
 *
 *   - Opening a drawer adds one history entry; switching to another record
 *     while one is open replaces it rather than stacking another.
 *   - Closing a drawer this page opened goes BACK one step, so the entry it
 *     added is removed and no duplicate same-address entry is left (the first
 *     Back after X used to appear to do nothing).
 *   - A drawer that arrived with ?open in the address (a link, a refresh) was
 *     not opened here, so closing it replaces the address as before.
 *
 * Screens that manage their own history (Finance) do not pass it and behave
 * exactly as before.
 */
export function useOpenParam(rows, { ownEntry = false } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("open");
  // True between "this page added (or re-pointed) the drawer's entry" and the
  // moment the entry is marked. The mark lives on the history entry itself, so
  // it survives a refresh and is never carried to an entry we did not add.
  const justOpened = useRef(false);
  useEffect(() => {
    if (!ownEntry || !openId || !justOpened.current || typeof window === "undefined") return;
    justOpened.current = false;
    window.history.replaceState({ ...(window.history.state ?? {}), stOwn: true }, "", window.location.href);
  }, [ownEntry, openId]);

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
      const url = withOpen(row.id);
      if (ownEntry && openId) {
        // Switching records inside an open drawer: one entry for the drawer.
        const wasOurs = typeof window !== "undefined" && Boolean(window.history.state?.stOwn);
        router.replace(url, { scroll: false });
        if (wasOurs) justOpened.current = true;
        return;
      }
      router.push(url, { scroll: false });
      if (ownEntry) justOpened.current = true;
    },
    [router, withOpen, ownEntry, openId]
  );

  // replace, so closing doesn't add a second history entry to step back through.
  const closeDetail = useCallback(() => {
    if (ownEntry && typeof window !== "undefined" && window.history.state?.stOwn) {
      router.back();
      return;
    }
    router.replace(withOpen(null), { scroll: false });
  }, [router, withOpen, ownEntry]);

  return { detail, openDetail, closeDetail };
}
