"use client";

/**
 * A drawer section that carries its answer in the heading.
 *
 * The point of collapsing is not to hide things — it is that "Games · 3 · 2-1"
 * answers the question without opening anything. A collapsed section with a
 * bare title just costs a tap.
 */
export function Collapsible({ id, title, summary, open, onToggle, children, tone }) {
  return (
    <section className="detail-section collapsible" id={id}>
      <button
        className={`collapsible-head${open ? " open" : ""}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
      >
        <span className={`collapsible-caret${open ? "" : " collapsed"}`} aria-hidden="true">
          ▾
        </span>
        <span className="collapsible-title">{title}</span>
        {summary && (
          <span className={`collapsible-summary${tone ? ` tone-${tone}` : ""}`}>{summary}</span>
        )}
      </button>

      {open && (
        <div className="collapsible-body" id={`${id}-body`}>
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Where a tournament sits relative to today.
 *
 * Drives which sections open by default: Games is expanded while an event is
 * happening, because that is when a coach is entering scores, and Tournament
 * Review only exists once there is something to review.
 */
export function tournamentPhase(t, today = new Date()) {
  const start = t.start_date ? new Date(`${t.start_date}T00:00:00`) : null;
  const end = new Date(`${t.end_date ?? t.start_date ?? ""}T23:59:59`);
  if (!start || Number.isNaN(start.getTime())) return "upcoming";

  const now = today;
  if (now < start) return "upcoming";
  if (now <= end) return "during";
  return "past";
}

/**
 * The tournament's record, but only when it can be stated honestly.
 *
 * `result` is W or L with no tie value, and a game keeps a null result until a
 * score is entered. A partial record would read as fact, so it is withheld
 * until every game has one.
 */
export function gameRecord(games = []) {
  if (games.length === 0) return null;
  const played = games.filter((g) => g.result);
  if (played.length !== games.length) return null;

  const w = played.filter((g) => g.result === "W").length;
  const l = played.filter((g) => g.result === "L").length;
  return `${w}-${l}`;
}
