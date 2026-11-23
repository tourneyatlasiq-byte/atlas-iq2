"use client";

import { useEffect, useState } from "react";
import { localDateIso } from "../lib/local-date";
import { nextMidnightDelayMs } from "../lib/dues-schedule";

/**
 * This device's calendar date, or null until the browser has reported it.
 *
 * Past-due statuses depend on the date, so nothing date-based may be claimed
 * from the server's clock (which is UTC, and can be a day ahead of an evening
 * in the U.S.). The first render returns null and the screen shows a neutral
 * state; the real date arrives as soon as the page mounts.
 *
 * It is read again when the day changes (just after local midnight) and when
 * the app comes back to the front, the tab becomes visible, or the page is
 * restored from the back/forward cache, so a screen left open overnight or an
 * app resumed the next morning corrects itself without a reload.
 *
 * Version 1 uses the device date. Two devices in different time zones can
 * therefore disagree for a few hours around midnight. There is no stored
 * organization time zone yet; that is a prerequisite for reports and reminders.
 */
export function useDeviceToday() {
  const [today, setToday] = useState(null);
  useEffect(() => {
    let timer;
    const sync = () => {
      const now = localDateIso();
      setToday((cur) => (cur === now ? cur : now));
      clearTimeout(timer);
      timer = setTimeout(sync, nextMidnightDelayMs());
    };
    sync();
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    const onShow = () => sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, []);
  return today;
}
