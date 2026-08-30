"use client";

/**
 * The last resort: a failure in the root layout itself, which is the one place
 * app/(app)/error.js cannot catch because the layout that would render it is
 * the thing that broke.
 *
 * It must supply its own <html> and <body> — there is no working layout above
 * it — and for the same reason it cannot rely on the stylesheet having loaded.
 * The styles here are inline on purpose; every other page in the product uses
 * globals.css, and this file is deliberately the exception.
 *
 * Included because without it a root-layout failure falls all the way through
 * to the framework's own screen, which is the outcome this work exists to
 * remove. It should effectively never render.
 */
export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f8fafc",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: "#0b2341",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "left" }}>
          <p
            style={{
              margin: "0 0 6px",
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ margin: "0 0 10px", fontSize: 24, lineHeight: 1.25 }}>
            Season Tempo couldn&rsquo;t start
          </h1>
          <p style={{ margin: "0 0 18px", fontSize: 15, lineHeight: 1.6, color: "#334155" }}>
            The problem is on our side. Nothing you had already saved has been lost.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minHeight: 44,
              padding: "0 18px",
              borderRadius: 10,
              border: "1px solid #0b2341",
              background: "#0b2341",
              color: "#ffffff",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error?.digest && (
            <p style={{ margin: "16px 0 0", fontSize: 13, color: "#64748b" }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
