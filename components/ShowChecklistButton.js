"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { showGettingStarted } from "../lib/actions/onboarding";

/**
 * Bring the Getting started card back on Home after it was hidden. Lives in
 * Help so a coach who hid it can always find the way back.
 *
 * Renders only while the checklist is hidden, plus the confirmation after it
 * is restored. It stays mounted across the page refresh that restoring causes,
 * so its own "done" state is what keeps the confirmation on screen.
 */
export function ChecklistRestore({ hidden }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  if (!hidden && !done) return null;

  return (
    <section className="hc-restore" id="checklist-restore" aria-label="Setup checklist">
      {done ? (
        <p className="hc-restore-done" role="status">
          The checklist is back on Home. <Link href="/dashboard" className="link">Go to Home</Link>
        </p>
      ) : (
        <>
          <p>The setup checklist is hidden on Home.</p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await showGettingStarted();
                if (res?.ok) setDone(true);
                else setError(res?.error ?? "Could not show the checklist. Try again.");
              })
            }
          >
            {pending ? "Showing…" : "Show checklist on Home"}
          </button>
          {error && <p className="hc-unavailable" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
