/**
 * Small geometric marks for the Home snapshot sections.
 *
 * Drawn in one stroke language — same weight, same 20px box, same angular
 * vocabulary as the contour motif — so the three read as a set rather than as
 * clip-art borrowed from an icon pack. They aid scanning; the label beside
 * each one still carries the meaning, so nothing depends on the glyph alone.
 */
export function ModuleMark({ kind }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: "false",
    className: "module-mark",
  };

  if (kind === "season") {
    // Route chevrons: progression, what comes next.
    return (
      <svg {...common}>
        <path d="M3 14.5 L8 5.5 L13 14.5" />
        <path d="M12 9 L16.5 9" />
      </svg>
    );
  }

  if (kind === "team") {
    // Roster marks: a line-up, not a person pictogram.
    return (
      <svg {...common}>
        <path d="M3.5 15 L3.5 8" />
        <path d="M8 15 L8 4.5" />
        <path d="M12.5 15 L12.5 9.5" />
        <path d="M17 15 L17 6.5" />
      </svg>
    );
  }

  // Finance: ascending steps — budget against spend.
  return (
    <svg {...common}>
      <path d="M3 15.5 L7.5 15.5 L7.5 11 L12 11 L12 6.5 L16.5 6.5" />
      <path d="M16.5 6.5 L16.5 15.5 L3 15.5" strokeOpacity="0.4" />
    </svg>
  );
}
