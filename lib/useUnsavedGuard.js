"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Protects unsaved edits from being thrown away by accident.
 *
 * While `dirty` is true:
 *   - closing or reloading the tab shows the browser's own leave prompt
 *   - clicking any in-app link (back link, sidebar, Start Tracking) is held and
 *     reported as `pending`, so the screen can ask "Leave without saving?"
 *   - the browser or phone Back button is held the same way
 *
 * The app router has no navigation events to cancel, so in-app links are caught
 * in the capture phase before Next sees them. Modified clicks (new tab), links
 * to other sites and same-page links are left alone.
 *
 * Returns { pending, stay, leave }. `leave` completes the held navigation.
 */
export function useUnsavedGuard(dirty) {
  const router = useRouter();
  const [pending, setPending] = useState(null);
  const dirtyRef = useRef(dirty);
  const sentinel = useRef(false);
  const bypass = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return undefined;

    const onBeforeUnload = (e) => {
      if (bypass.current) return;
      e.preventDefault();
      e.returnValue = "";
    };

    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target?.closest?.("a[href]");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ href: `${url.pathname}${url.search}${url.hash}` });
    };

    // Back button: park one history entry above the page so Back lands on it
    // instead of leaving. Pushed once while dirty; re-pushed after each hold.
    const onPop = () => {
      sentinel.current = false;
      if (!dirtyRef.current || bypass.current) return;
      window.history.pushState(null, "", window.location.href);
      sentinel.current = true;
      setPending({ back: true });
    };
    if (!sentinel.current) {
      window.history.pushState(null, "", window.location.href);
      sentinel.current = true;
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, [dirty]);

  const stay = useCallback(() => setPending(null), []);

  const leave = useCallback(() => {
    const held = pending;
    setPending(null);
    bypass.current = true;
    if (held?.href) router.push(held.href);
    else if (held?.back) window.history.go(-2);
  }, [pending, router]);

  return { pending, stay, leave };
}
