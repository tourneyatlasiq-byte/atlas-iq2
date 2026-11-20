"use client";

import { useEffect, useState } from "react";
import { localDateIso } from "../lib/local-date";

/**
 * Today's date on this device (2026-11).
 *
 * Returns the server's date on the first render so the page matches the HTML
 * the server sent, then the device's own date as soon as the browser mounts.
 * It refreshes when the tab comes back to the front and at the next local
 * midnight, so a page left open overnight rolls over without a reload.
 */
export function useLocalToday(serverToday) {
  const [today, setToday] = useState(serverToday);
  useEffect(() => {
    let timer;
    const sync = () => {
      setToday((cur) => {
        const now = localDateIso();
        return cur === now ? cur : now;
      });
      clearTimeout(timer);
      const next = new Date();
      next.setHours(24, 0, 1, 0);
      timer = setTimeout(sync, Math.min(next - Date.now(), 2 ** 31 - 1));
    };
    sync();
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return today;
}
