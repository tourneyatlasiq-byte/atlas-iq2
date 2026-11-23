"use client";

/**
 * The last resort: a failure in the root layout itself, which is the one place
 * app/(app)/error.js cannot catch because the layout that would render it is
 * the thing that broke.
 *
 * It must supply its own <html> and <body> — there is no working layout above
 * it — and for the same reason it cannot rely on the stylesheet having loaded.
 * The styles here are inline on purpose; every other page in the product uses
 * globals.css, and this file is deliberately the exception. Its values are the
 * Volt tokens written out (ink #0c0f14, volt #d2ff3d, muted #626b79, base
 * #f6f7f9) because the token stylesheet is not available here.
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
          background: "#f6f7f9",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: "#0c0f14",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "left" }}>
          <p
            style={{
              margin: "0 0 6px",
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#626b79",
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ margin: "0 0 10px", fontSize: 26, lineHeight: 1.2, fontWeight: 800, letterSpacing: "-0.03em" }}>
            Season Tempo couldn&rsquo;t start
          </h1>
          <p style={{ margin: "0 0 18px", fontSize: 15, lineHeight: 1.6, color: "#3b4350" }}>
            The problem is on our side. Nothing you had already saved has been lost.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minHeight: 44,
              padding: "0 18px",
              borderRadius: 12,
              border: "none",
              background: "#d2ff3d",
              boxShadow: "inset 0 -2px 0 rgba(12, 15, 20, 0.12)",
              color: "#0c0f14",
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error?.digest && (
            <p style={{ margin: "16px 0 0", fontSize: 13, color: "#626b79" }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
