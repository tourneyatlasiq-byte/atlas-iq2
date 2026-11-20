"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Running a mutation from the client.
 *
 * THE RULE THIS EXISTS TO ENFORCE: no action may appear to do nothing.
 *
 * Two failures put this here, both found on a phone:
 *
 *   Make inactive SUCCEEDED and the drawer went on showing "Active". The
 *   server revalidated its cache, but nothing told the open drawer to take
 *   the new data, so the coach saw no change and assumed the tap missed.
 *
 *   Remove from roster FAILED and said nothing, because the error rendered at
 *   the top of the Team page — underneath a fixed, full-height drawer. On a
 *   phone that message is not merely easy to miss; it cannot be seen at all.
 *
 * So this owns the MECHANICS every mutation shares — pending state, awaiting
 * the action, and refreshing the route so an open drawer receives persisted
 * state — and deliberately owns nothing else. It does not decide where an
 * error appears, whether success closes a drawer, or what a confirmation
 * says. Those differ per action and belong to the caller.
 *
 * The error is RETURNED as well as stored, so a caller rendering feedback in
 * its own surface does not have to read shared state to know what happened.
 */
export function useMutation({ onError } = {}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const router = useRouter();
  // One save at a time per form (Release 3). While a request from this form is
  // still in flight, any further submit from it waits, even if the values
  // changed: a second write racing the first is how duplicates and lost edits
  // happen. Other forms use their own runner and stay usable.
  const busy = useRef(false);

  /**
   * @param action   a server action taking FormData
   * @param fd       the FormData
   * @param opts.onSuccess  runs after a successful action, before the refresh
   * @param opts.refresh    default true. Set false only when the caller
   *                        navigates away, where a refresh is wasted work.
   */
  const run = useCallback((action, fd, { onSuccess, onError: onErrorLocal, refresh = true } = {}) => {
    // A per-call handler wins over the hook-level one: some callers classify
    // the failure (an empty-contact refusal is a choice, not an error) and
    // others just want it rendered.
    const report = (message, result) =>
      (onErrorLocal ?? onError)?.(message, result);
    if (busy.current) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await action(fd);
      } catch (e) {
        // A thrown action still has to say something. Silence here is the
        // exact failure this module exists to prevent.
        busy.current = false;
        const message = e?.message ?? "Something went wrong. Try again.";
        setError(message);
        report(message, null);
        return;
      }
      busy.current = false;

      if (result?.ok) {
        onSuccess?.(result);
        // revalidatePath() marks the SERVER cache stale. This is what makes an
        // already-open drawer re-render with what was actually persisted.
        // Without it a successful change is invisible until the coach closes
        // and reopens, which reads as the action having failed.
        if (refresh) router.refresh();
        return;
      }

      const message = result?.error ?? "Something went wrong. Try again.";
      setError(message);
      report(message, result);
    });
  }, [router, onError]);

  return { run, pending, error, setError, clearError: () => setError(null) };
}
