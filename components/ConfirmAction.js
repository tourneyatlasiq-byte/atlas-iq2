"use client";

import { useState, useCallback, useEffect, useRef } from "react";

/**
 * Confirming a destructive action inside the app.
 *
 * window.confirm() is the reason a coach tapped Remove and watched nothing
 * happen. A mobile browser that suppresses dialogs — pop-up blocking,
 * repeated-dialog suppression, an in-app webview — returns false, the handler
 * returns early, and there is no request, no spinner and no message. The
 * failure is indistinguishable from a dead button, and it was proven in
 * production: the roster row was still there afterwards.
 *
 * It is also the wrong shape for a drawer. A native dialog is a page-level
 * interruption; the decision belongs beside the thing being deleted.
 *
 * This holds only the QUESTION being asked. Callers keep their own wording,
 * their own action, and their own idea of where the confirmation belongs —
 * the pattern is shared, the presentation is not.
 */
export function useConfirm() {
  const [asking, setAsking] = useState(null);

  const ask = useCallback((key) => setAsking(key), []);
  const cancel = useCallback(() => setAsking(null), []);
  const isAsking = useCallback((key) => asking === key, [asking]);

  return { asking, ask, cancel, isAsking };
}

/**
 * The confirmation itself, rendered in place of whatever triggered it.
 *
 * Deliberately not a modal: a modal over a drawer is another layer that can
 * mis-stack, and on a phone it moves the decision away from the thumb. This
 * sits where the action was.
 */
export function ConfirmAction({
  message,
  confirmLabel = "Remove",
  pendingLabel = "Removing…",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  pending = false,
  error = null,
}) {
  const ref = useRef(null);

  /**
   * Bring the question into view.
   *
   * An inline confirmation solves the suppressed-dialog problem but creates a
   * new one: rendered on the last row of a long list it can sit below the
   * fold, so the coach clicks Delete and sees nothing — the same symptom by a
   * different route. Scrolling to it makes the question unmissable wherever
   * the row happens to be.
   *
   * `nearest` rather than `center`: if it is already visible nothing moves,
   * so a confirmation at the top of the screen does not yank the page.
   */
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  return (
    <div className="confirm-inline" role="alert" ref={ref}>
      <p className="confirm-inline-message">{message}</p>
      {/* A failure has to appear HERE. Rendered at container level it would
          sit underneath the drawer that asked the question. */}
      {error && <p className="confirm-inline-error">{error}</p>}
      <div className="confirm-inline-actions">
        <button type="button" className="btn btn-secondary btn-sm"
                onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </button>
        <button type="button" className="btn btn-danger btn-sm"
                onClick={onConfirm} disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
