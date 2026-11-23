import { statusFacets } from "../lib/tournament-status";

/**
 * Decision, registration and payment as three plainly labeled facts.
 * The words carry the meaning; the small mark beside each only reinforces it
 * (filled = done, dashed = undecided, hatched = waiting, struck = not so),
 * so nothing depends on color. Presentation only.
 */
export function StatusFacets({ t, transactions = [], showDetail = true }) {
  const f = statusFacets(t, transactions);
  const chips = [["Decision", f.decision], ["Registration", f.registration], ["Payment", f.payment]].filter(([, v]) => v);
  return (
    <span className="sf" role="group" aria-label="Status">
      <span className="sf-chips">
        {chips.map(([k, v]) => (
          <span key={k} className={`sf-chip sf-${v.tone}`} title={k}>
            <i className="sf-mark" aria-hidden="true" />
            <span className="sf-k">{k}: </span>{v.label}
          </span>
        ))}
      </span>
      {showDetail && f.detail && <span className="sf-detail">{f.detail}</span>}
    </span>
  );
}
