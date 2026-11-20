"use client";

import { lockScroll as lockPageScroll } from "../lib/scrollLock";
import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useGuardedOverlay } from "./useGuardedOverlay";

/**
 * The sheet every Group 1 interaction opens in.
 *
 * Built on the existing modal-backdrop / modal-sheet classes, so it inherits
 * the verified phone behaviour: full screen on phones, sized to the visible
 * viewport when the keyboard opens, head pinned at the top, actions pinned at
 * the bottom, only the middle scrolls, and dialogs stack above drawers.
 *
 * Escape and the labelled Close both close it; page scrolling is locked while
 * it is open and restored afterwards. Focus moves into the sheet on open and
 * back to whatever opened it on close.
 */
export function StSheet({ eyebrow, title, onClose, back, children, foot, size = "md", busy = false, labelledBy = "st-sheet-title", closeWithBack = false }) {
  const ref = useRef(null);
  // Opt in (Tournaments and Team only): Back closes this sheet first, Close,
  // Escape and the backdrop go through one door, and a sheet whose values
  // differ from how it opened asks before discarding. Finance keeps its own
  // history handling and does not pass this.
  const guard = useGuardedOverlay({ onClose, enabled: closeWithBack, busy });
  const close = closeWithBack ? guard.requestClose : onClose;
  const opener = useRef(null);
  useEffect(() => {
    opener.current = document.activeElement;
    const unlock = lockPageScroll();
    const f = ref.current?.querySelector("[data-autofocus]") ?? ref.current?.querySelector("h2");
    f?.focus?.({ preventScroll: true });
    // With closeWithBack the guard owns Escape (it may need to ask first).
    const onKey = (e) => { if (e.key === "Escape" && !busy && !closeWithBack) onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => {
      unlock();
      document.removeEventListener("keydown", onKey);
      opener.current?.focus?.({ preventScroll: true });
    };
    // Mount and unmount only: re-running would steal focus on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop st-sheet-backdrop" role="presentation" onClick={busy ? undefined : close}>
      <div ref={(el) => { ref.current = el; guard.ref.current = el; }} className={`modal modal-sheet st-sheet st-sheet-${size}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head st-sheet-head">
          <div className="st-sheet-titles">
            {back && (
              <button type="button" className="st-sheet-back" onClick={back.onClick} disabled={busy}>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {back.label}
              </button>
            )}
            {eyebrow && <span className="st-eyebrow">{eyebrow}</span>}
            <h2 id={labelledBy} tabIndex={-1}>{title}</h2>
          </div>
          <button type="button" className="st-sheet-close" onClick={close} disabled={busy}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
            Close
          </button>
        </div>
        <div className="modal-body st-sheet-body">{children}</div>
        {closeWithBack && guard.prompt}
        {foot && <div className="modal-foot modal-foot-sticky st-sheet-foot">{foot}</div>}
      </div>
    </div>
  );
}

/** Inline error for a sheet. Says what happened and that entries are kept. */
export function SheetError({ children }) {
  if (!children) return null;
  return (
    <div className="st-err" role="alert">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 7.5v5.5M12 16.5h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      <span>{children}</span>
    </div>
  );
}

export const SAVE_FAILED = "Nothing you entered was lost. Check your connection and try again.";

/** Runs a server action from plain fields. Network failures become a result, never a throw. */
export async function callAction(action, fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null) fd.set(k, String(v));
  try {
    return await action(fd);
  } catch (e) {
    return { ok: false, error: `Couldn't reach Season Tempo. ${SAVE_FAILED}`, network: true };
  }
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Nov 27, 2026" from an ISO date; the raw value if it isn't one. */
export function fmtDay(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Refresh the page data, then run `then` once the refreshed screen is on
 * display. A confirmation that arrives before the numbers it describes reads
 * as a failure ("it says registered, the card says not registered").
 */
export function useRefreshThen() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const queued = useRef([]);
  useEffect(() => {
    if (refreshing || queued.current.length === 0) return;
    const fns = queued.current; queued.current = [];
    fns.forEach((f) => f());
  }, [refreshing]);
  const refreshThen = (then) => {
    if (then) queued.current.push(then);
    startTransition(() => router.refresh());
  };
  return [refreshing, refreshThen];
}
