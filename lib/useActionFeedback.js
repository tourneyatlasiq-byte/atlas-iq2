"use client";

import { useState, useTransition, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The shared shape every component already used, plus a transient success
 * notice.
 *
 * Eight components carried a near-identical `run(action, fd, onDone)` helper,
 * so the seam for feedback already existed. A global provider would add an
 * app-wide client boundary to solve a problem that is entirely page-scoped:
 * nothing needs to read a confirmation from another route, and a notice should
 * not survive navigation away from the screen that produced it.
 *
 * Errors persist until the next action or an explicit dismissal. Success
 * notices clear themselves, because a confirmation that lingers becomes
 * furniture.
 */
export function useActionFeedback({ successMs = 3000 } = {}) {
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef(null);
  const router = useRouter();
  // One save at a time per screen (Release 3): while a request from this screen
  // is in flight, another submit waits, even with different values.
  const busy = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  const showNotice = useCallback((message) => {
    if (!message) return;
    clearTimeout(timer.current);
    setNotice(message);
    timer.current = setTimeout(() => setNotice(null), successMs);
  }, [successMs]);

  /**
   * run(action, formData, onDone)
   * run(action, formData, { onDone, success })
   *
   * The two-argument object form is only needed when a success notice is
   * wanted. Passing a bare function keeps every existing call site working
   * unchanged.
   */
  const run = useCallback((action, arg, opts) => {
    const onDone = typeof opts === "function" ? opts : opts?.onDone;
    const success = typeof opts === "function" ? null : opts?.success;

    if (busy.current) return;
    busy.current = true;
    setError(null);
    setNotice(null);

    startTransition(async () => {
      let result;
      try {
        result = await action(arg);
      } catch {
        busy.current = false;
        setError("Couldn't reach Season Tempo. Nothing you entered was lost. Check your connection and try again.");
        return;
      }
      busy.current = false;
      if (result?.ok) {
        onDone?.(result);
        showNotice(typeof success === "function" ? success(result) : success);
        // The success notice says a change happened; this makes the change
        // actually appear. Without it a drawer left open kept showing
        // pre-mutation values while announcing success — the same staleness
        // that made Make inactive look like it had failed.
        router.refresh();
      } else {
        setError(result?.error ?? "Something went wrong. Try again.");
      }
    });
  }, [showNotice, router]);

  return { error, setError, notice, setNotice, pending, run };
}
