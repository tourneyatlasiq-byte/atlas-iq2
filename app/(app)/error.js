"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * What a coach sees when something inside the product throws.
 *
 * Without this file Next.js renders its own error screen: a stack trace in
 * development, an unstyled "Application error" in production. Either way the
 * coach is looking at something that is not Season Tempo, with nothing to do
 * next except close the tab — and they are usually on a phone, at a field,
 * mid-task.
 *
 * Scoped to the (app) group deliberately, so it wraps the authenticated
 * product and leaves the marketing pages and the login flow alone.
 *
 * WHAT IS NOT SHOWN: error.message, the stack, and anything from the database.
 * A Postgres error can name a table, a column or a constraint, and a coach can
 * neither act on that nor should they see it. The digest is shown instead —
 * Next generates it per error and writes the full detail to the server log, so
 * a coach can quote six characters and we can find the exact failure.
 */
export default function AppError({ error, reset }) {
  useEffect(() => {
    // Server logging is preserved: this is the client half, so a failure that
    // happens after hydration is not lost.
    console.error("Product error boundary:", {
      digest: error?.digest,
      message: error?.message,
    });
  }, [error]);

  return (
    <div className="errpage">
      <div className="errpage-card">
        <p className="errpage-eyebrow">Something went wrong</p>
        <h1 className="errpage-title">We couldn&rsquo;t load that</h1>
        <p className="errpage-body">
          The problem is on our side, not yours. Nothing you had already saved has
          been lost — try again, and if it keeps happening let us know.
        </p>

        <div className="errpage-actions">
          {/* Re-runs the failed render. A transient failure — a dropped
              connection, a slow query — recovers here without a full reload. */}
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <Link className="btn btn-secondary" href="/dashboard">
            Return home
          </Link>
        </div>

        {error?.digest && (
          <p className="errpage-ref">
            Reference <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
