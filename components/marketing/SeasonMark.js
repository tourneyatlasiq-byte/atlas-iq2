/**
 * Season Tempo marks used on the public site.
 *
 * Geometry matches components/SeasonTempoLogo.js exactly (100-unit box, gold
 * "next" point at 1.5x). Kept separate only because the marketing header
 * needs the wordmark in a <span> it can style responsively.
 */
export function Wordmark({ tone = "light" }) {
  const base = tone === "light" ? "#FFFFFF" : "#0B2341";
  return (
    <>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <rect x="14" y="46" width="64" height="8" rx="4" fill={base} />
        <circle cx="14" cy="50" r="8.5" fill={base} />
        <circle cx="34" cy="50" r="8.5" fill={base} />
        <circle cx="54" cy="50" r="8.5" fill={base} />
        <circle cx="78" cy="50" r="12.75" fill="#F4B400" />
      </svg>
      <span className="st-word">SEASON TEMPO</span>
    </>
  );
}

/** Chapter progress marker: four points on a track, `active` is 0-3. */
export function ChapterMarker({ active }) {
  const xs = [12, 44, 76, 108];
  return (
    <svg viewBox="0 0 120 24" aria-hidden="true" focusable="false">
      <rect x="12" y="10" width="96" height="4" rx="2" fill="#C3CCD6" />
      {active > 0 && <rect x="12" y="10" width={xs[active] - 12} height="4" rx="2" fill="#0B2341" />}
      {xs.map((x, i) =>
        i === active ? (
          <circle key={x} cx={x} cy="12" r="8" fill="#F4B400" />
        ) : (
          <circle key={x} cx={x} cy="12" r="5" fill={i < active ? "#0B2341" : "#C3CCD6"} />
        )
      )}
    </svg>
  );
}
