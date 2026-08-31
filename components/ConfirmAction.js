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

/**
 * The same question, as a modal.
 *
 * An inline confirmation is right inside a drawer or a card, where it sits
 * next to what it is about and cannot be lost. It is the wrong shape inside an
 * expandable table: it renders as a block child of a grid board, it is
 * unmounted the moment the coach collapses the category, and on the last row
 * it lands against the page footer.
 *
 * A row-level destructive action gets this instead. It is centred, it cannot
 * be scrolled past, and collapsing the category behind it changes nothing.
 *
 * Escape and a backdrop click both cancel, and neither does while the action is
 * in flight — dismissing a request that is already running would leave the
 * coach unsure whether it happened.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  pendingLabel = "Working…",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  pending = false,
  error = null,
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !pending) onCancel?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={pending ? undefined : onCancel}
    >
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title ?? confirmLabel}</h2>
        </div>

        <div className="modal-body">
          <p className="section-body">{message}</p>
          {error && <div className="alert alert-error">{error}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
