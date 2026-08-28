"use client";

/**
 * Table sorting, once.
 *
 * Extracted from Facilities, which already had a correct implementation:
 * ascending-then-descending on one column at a time, missing values last in
 * both directions, a stable tiebreak, and real aria-sort. Rewriting that per
 * page is how four tables end up sorting blanks four different ways.
 *
 * TWO RULES WORTH STATING, because they are the ones easy to get wrong:
 *
 * 1. SORT THE VALUE, NOT THE TEXT. "05/02/2011" sorts as a string before
 *    "12/09/2009"; the dates do not. Every sortable column supplies a value
 *    function returning a number, a Date, or a string — never the formatted
 *    cell.
 *
 * 2. MISSING GOES LAST, ALWAYS. Not first when ascending and last when
 *    descending. A coach sorting by date of birth wants the players who have
 *    one; the fourteen who do not should not push them off the screen, in
 *    either direction.
 */

import { useMemo, useState } from "react";

const isMissing = (v) =>
  v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));

/**
 * Compare two already-extracted values.
 *
 * Numbers compare numerically, dates by time, everything else with
 * localeCompare's numeric collation so "Player 2" precedes "Player 10".
 */
function compareValues(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Sort rows by a column definition.
 *
 * `columns` maps a key to { value } — the accessor. `tiebreak` keeps equal
 * values in a fixed order so a re-render never reshuffles them, which would
 * otherwise make a row appear to move under the cursor.
 */
export function sortRows(rows, sort, columns, tiebreak) {
  if (!sort?.key) return rows;
  const col = columns?.[sort.key];
  if (!col?.value) return rows;

  const dir = sort.dir === "desc" ? -1 : 1;

  return [...rows].sort((a, b) => {
    const av = col.value(a);
    const bv = col.value(b);

    // Missing last in BOTH directions — deliberately outside the dir flip.
    if (isMissing(av) && isMissing(bv)) return tiebreak ? tiebreak(a, b) : 0;
    if (isMissing(av)) return 1;
    if (isMissing(bv)) return -1;

    const diff = compareValues(av, bv) * dir;
    if (diff !== 0) return diff;
    return tiebreak ? tiebreak(a, b) : 0;
  });
}

/**
 * Sort state. Null means "the page's own default ordering", which is
 * preserved until the coach chooses otherwise — a roster ordered by jersey
 * number, a ledger newest-first and a schedule by date all mean something,
 * and adding sorting must not quietly redefine them.
 */
export function useTableSort(initial = null) {
  const [sort, setSort] = useState(initial);
  const toggleSort = (key) =>
    setSort((cur) => (cur?.key === key
      ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
      : { key, dir: "asc" }));
  return { sort, setSort, toggleSort };
}

/** Sorted rows for the current sort, memoised. */
export function useSortedRows(rows, sort, columns, tiebreak) {
  return useMemo(
    () => sortRows(rows, sort, columns, tiebreak),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sort?.key, sort?.dir],
  );
}
