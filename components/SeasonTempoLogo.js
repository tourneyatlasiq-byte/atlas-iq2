/**
 * Season Tempo — brand mark and lockup.
 *
 * The live Season Tempo identity. components/Logo.js retains the previous
 * Atlas IQ mark and is no longer referenced by any call site.
 *
 * The mark is "Season Track": events along a season, with the gold point on
 * what is next — the same idea the Home screen already leads with.
 *
 * Solid geometry only. No transparency, gradients, shadows or strokes, because
 * every one of those degrades at 16px or in monochrome. The gold point is 1.5x
 * the others so "next up" survives every reduction.
 *
 * Geometry is defined once in a 100-unit box and scaled, so 16px and 96px are
 * the same drawing rather than two hand-tuned versions that drift apart.
 */

const TRACK_Y = 50;
const POINTS = [14, 34, 54];
const NEXT_X = 78;
const DOT_R = 8.5;
const NEXT_R = DOT_R * 1.5;

/**
 * `tone` picks how the mark colours itself:
 *   "navy"  — navy geometry, gold next point. For light backgrounds.
 *   "light" — white geometry, gold next point. For navy backgrounds.
 *   "mono"  — everything currentColor. Favicons, print, embroidery, any
 *             single-colour context where gold is unavailable.
 */
export function LogoMark({ size = 32, tone = "navy" }) {
  const base = tone === "light" ? "#FFFFFF" : tone === "mono" ? "currentColor" : "#0b2341";
  const next = tone === "mono" ? "currentColor" : "#f4b400";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x={POINTS[0]} y={TRACK_Y - 4} width={NEXT_X - POINTS[0]} height="8" rx="4" fill={base} />
      {POINTS.map((x) => (
        <circle key={x} cx={x} cy={TRACK_Y} r={DOT_R} fill={base} />
      ))}
      <circle cx={NEXT_X} cy={TRACK_Y} r={NEXT_R} fill={next} />
    </svg>
  );
}

/**
 * Full lockup. Both words carry equal weight in a single colour — TEMPO is
 * never gold and SEASON is never subordinate. The mark provides the only
 * accent.
 *
 * No sport name in the lockup: Season Tempo must be able to become multi-sport
 * without redrawing the identity. Sport context is marketing copy.
 */
export function LogoLockup({ size = 32, tone = "navy", wordSize }) {
  const text = tone === "light" ? "#FFFFFF" : tone === "mono" ? "currentColor" : "#0b2341";
  const word = wordSize ?? Math.round(size * 0.62);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.46) }}>
      <LogoMark size={size} tone={tone} />
      <span
        className="brand-word"
        style={{ color: text, fontSize: word, lineHeight: 1 }}
      >
        SEASON TEMPO
      </span>
    </span>
  );
}
