"use client";

/**
 * The sortable column heading.
 *
 * Kept apart from lib/table-sort.js so the comparison logic stays plain
 * JavaScript that a test can import directly — a module mixing JSX with the
 * rules cannot be exercised without a build step, and these rules are exactly
 * the part worth testing.
 *
 * A button inside the th, so keyboard operation and focus come for free rather
 * than from hand-written key handlers. The th carries aria-sort.
 */
export function SortHeader({ label, column, sort, onSort, className, title }) {
  const active = sort?.key === column;
  const dir = active ? sort.dir : null;

  return (
    <th
      className={className}
      aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        className={`th-sort${active ? " on" : ""}`}
        onClick={() => onSort(column)}
        title={title ?? `Sort by ${label}`}
      >
        <span className="th-sort-label">{label}</span>
        <span className="th-sort-mark" aria-hidden="true">
          {active ? (dir === "desc" ? "\u2193" : "\u2191") : "\u2195"}
        </span>
      </button>
    </th>
  );
}
