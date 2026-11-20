"use client";

import { useCallback, useEffect, useState } from "react";
import { dismissKey, isDismissed, dismiss } from "./session-dismiss";

/**
 * [dismissed, dismissNow, ready]. `ready` is false until the browser session
 * has been read, so a dismissed suggestion never flashes on first paint.
 */
export function useSessionDismiss(kind, id) {
  const key = dismissKey(kind, id);
  const [state, setState] = useState({ dismissed: false, ready: false });
  useEffect(() => {
    let store = null;
    try { store = window.sessionStorage; } catch { /* blocked */ }
    setState({ dismissed: isDismissed(store, key), ready: true });
  }, [key]);
  const now = useCallback(() => {
    let store = null;
    try { store = window.sessionStorage; } catch { /* blocked */ }
    dismiss(store, key);
    setState({ dismissed: true, ready: true });
  }, [key]);
  return [state.dismissed, now, state.ready];
}
