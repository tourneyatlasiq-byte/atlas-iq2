"use client";

/**
 * Review surface — TEMPORARY.
 *
 * Renders the real components, unchanged, so an external reviewer can see the
 * whole application on one printable page.
 *
 * Drawers and modals normally use fixed, full-screen overlays. Stacking a
 * dozen of them on one page would put them all on top of each other, so this
 * wrapper unpins them and lets each sit inline in its own section. That is a
 * containment change only — the components inside render exactly as they do in
 * the application.
 *
 * Callbacks are no-ops. Nothing on this page writes.
 */

const noop = () => {};

export function ReviewSection({ number, title, note, wide = false, children }) {
  return (
    <section className="rv-section">
      <header className="rv-header">
        <span className="rv-number">{String(number).padStart(2, "0")}</span>
        <div>
          <h2 className="rv-title">{title}</h2>
          {note && <p className="rv-note">{note}</p>}
        </div>
      </header>
      <div className={`rv-body${wide ? " rv-body-wide" : ""}`}>{children}</div>
    </section>
  );
}

/** Unpins a drawer or modal so it renders inline rather than over the page. */
export function Inline({ kind = "drawer", children }) {
  return <div className={`rv-inline rv-inline-${kind}`}>{children}</div>;
}

export { noop };
