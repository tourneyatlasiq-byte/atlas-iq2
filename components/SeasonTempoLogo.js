/**
 * Season Tempo brand mark and wordmark (Volt identity, approved 2026-11-18).
 *
 * The mark is "Season Track": events along a season, with the Volt point on
 * what is next. Solid geometry in a 100-unit box so 16px and 96px are one
 * drawing. The Volt point is 1.5x the others so "next up" survives reduction.
 *
 * `tone` picks the colours:
 *   "ink"   ink geometry, Volt next point with an ink ring. Light backgrounds.
 *   "light" white geometry, Volt next point. Dark backgrounds.
 *   "mono"  everything currentColor. Print and any single-colour context.
 * Wordmark: "Season Tempo" in Schibsted Grotesk 800, mixed case, one colour.
 * No sport name in the lockup, so the identity can serve more than one sport.
 */

const TRACK_Y = 50;
const POINTS = [14, 34, 54];
const NEXT_X = 78;
const DOT_R = 8.5;
const NEXT_R = DOT_R * 1.5;

const INK = "#0c0f14";
const VOLT = "#d2ff3d";

export function LogoMark({ size = 32, tone = "ink" }) {
  const base = tone === "light" ? "#FFFFFF" : tone === "mono" ? "currentColor" : INK;
  const next = tone === "mono" ? "currentColor" : VOLT;
  const ring = tone === "ink";

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true" focusable="false">
      <rect x={POINTS[0]} y={TRACK_Y - 4} width={NEXT_X - POINTS[0]} height="8" rx="4" fill={base} />
      {POINTS.map((x) => (
        <circle key={x} cx={x} cy={TRACK_Y} r={DOT_R} fill={base} />
      ))}
      <circle
        cx={NEXT_X}
        cy={TRACK_Y}
        r={NEXT_R}
        fill={next}
        stroke={ring ? INK : "none"}
        strokeWidth={ring ? 3 : 0}
      />
    </svg>
  );
}

export function LogoLockup({ size = 32, tone = "ink", wordSize }) {
  const text = tone === "light" ? "#FFFFFF" : tone === "mono" ? "currentColor" : INK;
  const word = +((wordSize ?? size * 0.62) * 1.12).toFixed(2);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.46) }}>
      <LogoMark size={size} tone={tone} />
      <span className="brand-word" style={{ color: text, fontSize: word, lineHeight: 1 }}>
        Season Tempo
      </span>
    </span>
  );
}
