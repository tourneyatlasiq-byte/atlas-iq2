/**
 * QAB% by game: the chart's arithmetic (2026-11).
 *
 * Pure functions, no React. The Performance page draws the chart; this decides
 * what is drawn. Nothing here computes a QAB figure: every percentage arrives
 * from getSeasonPerformance() on the game rows, and the season reference is the
 * page's own season figure (team.qabPct), which counts every recorded,
 * non-voided plate appearance, including a game still being tracked.
 *
 * One behaviour for every season length. There is no switch to a different
 * visualization at some number of games; only the marker size and label
 * density follow the width each game gets.
 */

/** Games that can be drawn: at least one plate appearance and a percentage. */
export function trendPoints(games) {
  return (games ?? []).filter((g) => g && g.pa > 0 && g.qabPct != null);
}

/**
 * The displayed vertical scale: zoomed to the season's useful range, never
 * 0 to 100 unless the data genuinely spans it. Whole tens, at least 30 points
 * tall, clamped to 0..100, with a margin of 4 points above and below the data
 * so a game at the extreme is not drawn on the edge. The season figure is
 * included so its reference line can never fall outside the plot.
 */
export function trendScale(values, seasonPct = null) {
  const v = [...values, ...(seasonPct == null ? [] : [seasonPct])].filter((n) => Number.isFinite(n));
  if (v.length === 0) return { lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] };

  let lo = Math.floor((Math.min(...v) - 4) / 10) * 10;
  let hi = Math.ceil((Math.max(...v) + 4) / 10) * 10;
  lo = Math.max(0, lo);
  hi = Math.min(100, hi);

  // Grow by tens (downward first, then upward) until the plot spans 30 points,
  // so a tightly bunched season is not blown up into an exaggerated swing.
  while (hi - lo < 30) {
    if (lo > 0) lo -= 10;
    if (hi - lo < 30 && hi < 100) hi += 10;
    if (lo === 0 && hi === 100) break;
  }

  const step = hi - lo > 50 ? 20 : 10;
  const ticks = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  return { lo, hi, ticks };
}

/** The sentence that states the scale, so the zoom is never implicit. */
export function scaleLabel(scale) {
  return `Scale ${scale.lo}% to ${scale.hi}%`;
}

/**
 * Consecutive games in the same tournament, in the order played. Each group
 * is { key, name, start, end } over indexes into the points array. Games with
 * no tournament share one unnamed group when adjacent.
 */
export function trendGroups(points) {
  const groups = [];
  points.forEach((g, i) => {
    const key = g.tournamentId ?? g.tournament ?? "";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.end = i;
    else groups.push({ key, name: g.tournament ?? "", start: i, end: i });
  });
  return groups;
}

/**
 * How each stretch of the line is drawn. A segment between two games is solid
 * only when BOTH are complete; a segment touching an in-progress game is
 * dotted, so the finished history is never extended as though a game still
 * being tracked were final.
 */
export function trendSegments(points) {
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    segments.push({
      from: i - 1,
      to: i,
      provisional: !points[i - 1].completed || !points[i].completed,
    });
  }
  return segments;
}

/** The index selected by a horizontal pixel position inside the plot. */
export function indexAtX(x, plotLeft, plotWidth, count) {
  if (count <= 0 || plotWidth <= 0) return 0;
  const i = Math.floor(((x - plotLeft) / plotWidth) * count);
  return Math.max(0, Math.min(count - 1, i));
}

/** Keyboard movement for the chart's slider. Returns the new index. */
export function indexForKey(key, current, count) {
  if (count <= 0) return 0;
  const last = count - 1;
  if (key === "ArrowLeft" || key === "ArrowDown") return Math.max(0, current - 1);
  if (key === "ArrowRight" || key === "ArrowUp") return Math.min(last, current + 1);
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (key === "PageDown") return Math.max(0, current - 5);
  if (key === "PageUp") return Math.min(last, current + 5);
  return current;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-04" -> "Oct 4". Null when there is no date. */
export function shortDate(d) {
  if (!d || typeof d !== "string") return null;
  const [, m, day] = d.split("-");
  const mi = Number(m) - 1;
  if (!(mi >= 0 && mi < 12) || !Number.isFinite(Number(day))) return null;
  return `${MONTHS[mi]} ${Number(day)}`;
}

/**
 * Labels along the bottom edge that would overlap the previous one are
 * dropped. Input: [{ x, text }] in left-to-right order; returns the subset to
 * draw, using an estimated glyph width.
 */
export function thinLabels(labels, charWidth = 5.4, gap = 6) {
  const kept = [];
  let edge = -Infinity;
  for (const l of labels) {
    const w = l.text.length * charWidth;
    if (l.x >= edge + gap) {
      kept.push(l);
      edge = l.x + w;
    }
  }
  return kept;
}
