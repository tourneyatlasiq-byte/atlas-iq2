"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Confirmations that say what changed and offer Undo.
 *
 * Positioned so they never cover the content just changed: bottom right on
 * desktop, above the bottom bar on phones. Dismissible, and they pause while
 * hovered or focused so Undo is never snatched away mid-reach. Polite live
 * region for confirmations, alert for errors.
 *
 * Undo is offered only where the app can genuinely reverse the write (a status
 * change, a payment entry, a transaction). The undo callback returns the
 * server result; a failed undo is reported, never swallowed.
 */
const ToastContext = createContext(null);
const LIFE = 8000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback((message, opts = {}) => {
    const id = ++seq.current;
    setToasts((all) => [...all.slice(-2), { id, message, ...opts }]);
    return id;
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="st-toasts" aria-live="polite">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={() => dismiss(t.id)} show={show} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss, show }) {
  const [busy, setBusy] = useState(false);
  const left = useRef(toast.undo || toast.retry ? LIFE : 4500);
  const started = useRef(Date.now());
  const timer = useRef(null);
  const [paused, setPaused] = useState(false);

  const arm = useCallback(() => {
    started.current = Date.now();
    clearTimeout(timer.current);
    timer.current = setTimeout(onDismiss, left.current);
  }, [onDismiss]);
  useEffect(() => { arm(); return () => clearTimeout(timer.current); }, [arm]);

  const pause = () => { if (paused) return; clearTimeout(timer.current); left.current -= Date.now() - started.current; setPaused(true); };
  const resume = () => { if (!paused) return; setPaused(false); arm(); };

  async function act(fn, doneMessage) {
    setBusy(true);
    clearTimeout(timer.current);
    let result;
    try { result = await fn(); } catch (e) { result = { ok: false, error: e?.message }; }
    onDismiss();
    if (result && result.ok === false) show(result.error ?? "Couldn't undo. Nothing was changed.", { kind: "error" });
    else if (doneMessage) show(doneMessage);
  }

  const err = toast.kind === "error";
  return (
    <div
      className={`st-toast${err ? " is-error" : ""}${paused ? " is-paused" : ""}`}
      role={err ? "alert" : "status"}
      onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={resume}
    >
      <span className="st-toast-icon" aria-hidden="true">
        {err ? (
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 7v6M12 16.5h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
      </span>
      <p>{toast.message}</p>
      {toast.undo && (
        <button type="button" className="st-toast-act" disabled={busy} onClick={() => act(toast.undo, toast.undoneMessage ?? "Undone.")}>
          {busy ? "Undoing" : "Undo"}
        </button>
      )}
      {toast.retry && (
        <button type="button" className="st-toast-act" disabled={busy} onClick={() => act(toast.retry)}>
          Try again
        </button>
      )}
      <button type="button" className="st-toast-x" aria-label="Dismiss" onClick={onDismiss}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      <span className="st-toast-life" style={{ animationDuration: `${toast.undo || toast.retry ? LIFE : 4500}ms` }} aria-hidden="true" />
    </div>
  );
}

/** show(message, { undo, undoneMessage, retry, kind }) */
export function useToast() {
  const show = useContext(ToastContext);
  // Outside the provider (marketing pages, the review route) it degrades to nothing
  // rather than throwing.
  return show ?? (() => {});
}
