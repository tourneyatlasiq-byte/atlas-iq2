"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmAction } from "./ConfirmAction";
import { useFormDirty } from "../lib/form-dirty";
import { useOverlayBack } from "../lib/overlay-history";

/**
 * One place that gives a form or sheet the Release 3 close behaviour:
 *
 *   - Back (and the phone's Back) closes THIS overlay first, not the page;
 *   - Close, Cancel, the backdrop and Escape all go through `requestClose`;
 *   - if what is in the form differs from what it opened with, closing asks
 *     "Leave without saving?" first, and Back is held the same way;
 *   - Save, which closes by itself, never asks and leaves no extra history.
 *
 * Usage: put `ref` on the overlay's root, call `requestClose` from every way
 * out, and render `prompt` once, near the overlay's action buttons.
 *
 *   const { ref, requestClose, prompt } = useGuardedOverlay({ onClose });
 */
export function useGuardedOverlay({ onClose, enabled = true, busy = false } = {}) {
  const ref = useRef(null);
  const dirty = useFormDirty(ref);
  const [asking, setAsking] = useState(false);
  const { requestClose: attempt } = useOverlayBack({
    onClose,
    dirty,
    enabled,
    onHold: () => setAsking(true),
  });

  const requestClose = useCallback(() => {
    if (busy) return;
    attempt();
  }, [attempt, busy]);

  // Escape goes through the same door, so it never discards typed work.
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) requestClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, requestClose]);

  const prompt = asking ? (
    <ConfirmAction
      message="Leave without saving? What you entered here will be lost."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onConfirm={() => { setAsking(false); onClose?.(); }}
      onCancel={() => setAsking(false)}
    />
  ) : null;

  return { ref, dirty, requestClose, prompt };
}
