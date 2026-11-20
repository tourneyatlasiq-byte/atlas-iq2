"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Back closes the top overlay first (Release 3, BACK-002).
 *
 * While an overlay (a sheet or form) is open it owns exactly ONE history entry,
 * tagged as ours, at the same address. So:
 *
 *   - the browser or phone Back button pops that entry and closes the overlay,
 *     not the page behind it;
 *   - closing with Close, Cancel, Save or Escape removes the entry again (a
 *     history step back, only when the entry on top is ours), so no duplicate
 *     same-address entry is left to step through;
 *   - an overlay whose values differ from what was loaded holds Back: the entry
 *     is put back and `onHold` is called so the screen can ask "Leave without
 *     saving?". Nothing is thrown away by a stray swipe.
 *
 * Opt-in per screen. It never reads or writes anything but history.state and
 * never navigates anywhere else; Finance keeps its own handling and is not
 * given this hook.
 *
 * The entry is added on the next tick and the add is cancelled if the overlay
 * unmounts first, so React's development double-mount cannot leave one behind.
 */

let nextToken = 1;

/** Pure: is the entry currently on top one of ours (this token)? */
export function isOurs(state, token) {
  return Boolean(state) && state.stOverlay === token;
}

export function useOverlayBack({ onClose, dirty = false, onHold, enabled = true } = {}) {
  const token = useRef(0);
  const dirtyRef = useRef(dirty);
  const closeRef = useRef(onClose);
  const holdRef = useRef(onHold);
  const quiet = useRef(0); // popstate events we caused ourselves and must not treat as the user's Back
  dirtyRef.current = dirty;
  closeRef.current = onClose;
  holdRef.current = onHold;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    if (!token.current) token.current = nextToken++;
    const mine = token.current;
    let pushed = false;

    const push = setTimeout(() => {
      window.history.pushState({ ...(window.history.state ?? {}), stOverlay: mine }, "", window.location.href);
      pushed = true;
    }, 0);

    const onPop = () => {
      if (quiet.current > 0) { quiet.current -= 1; return; }
      if (!pushed) return;
      if (isOurs(window.history.state, mine)) return; // a step that left our entry in place
      // Our entry was popped: this is the user's Back.
      pushed = false;
      if (dirtyRef.current) {
        // Hold: put the entry back and let the screen ask.
        window.history.pushState({ ...(window.history.state ?? {}), stOverlay: mine }, "", window.location.href);
        pushed = true;
        holdRef.current?.();
        return;
      }
      closeRef.current?.();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      clearTimeout(push);
      window.removeEventListener("popstate", onPop);
      // Closed by Close, Cancel, Save or Escape (not by Back): remove our entry.
      if (pushed && isOurs(window.history.state, mine)) {
        quiet.current += 1;
        window.history.back();
      }
    };
  }, [enabled]);

  /**
   * Ask to close. Held when the values differ from what was loaded; otherwise
   * closes now. Use this for Close, Cancel, the backdrop and Escape.
   */
  const requestClose = useCallback(() => {
    if (dirtyRef.current) { holdRef.current?.(); return false; }
    closeRef.current?.();
    return true;
  }, []);

  return { requestClose };
}
