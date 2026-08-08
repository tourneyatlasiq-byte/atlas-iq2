/**
 * Contour lines for the Next Up surface.
 *
 * An experiment, deliberately near-invisible. Atlas is about knowing where
 * you're going, and terrain lines say that without a literal map or a logo
 * repeated as wallpaper.
 *
 * If it reads as noise in the browser rather than texture, delete this file
 * and the one <TopoMotif /> in DashboardClient — the card is designed to hold
 * up as flat navy.
 */
export function TopoMotif() {
  return (
    <svg
      className="nextup-motif"
      viewBox="0 0 600 240"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1.1">
        <path d="M-20 196 C 90 168, 170 214, 268 182 S 470 128, 620 158" />
        <path d="M-20 170 C 96 140, 178 188, 276 154 S 476 98, 620 130" />
        <path d="M-20 144 C 102 112, 186 162, 284 126 S 482 68, 620 102" />
        <path d="M-20 118 C 108 84, 194 136, 292 98 S 488 38, 620 74" />
        <path d="M-20 92 C 114 56, 202 110, 300 70 S 494 8, 620 46" />
      </g>
    </svg>
  );
}
