"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Do the values in a form differ from what was loaded? (Release 3.)
 *
 * Merely having text in a field is not a change: the snapshot is taken once the
 * form is on screen, so a field that opens with a value is clean, and typing
 * something and then putting the original back is clean again. Text inputs,
 * selects, checkboxes and radios all count; buttons, files and anything marked
 * data-no-dirty (search boxes, pickers that filter a list) do not.
 */

const SKIP = 'input[type="button"],input[type="submit"],input[type="reset"],input[type="file"],input[type="search"],[role="combobox"],[data-no-dirty]';

/** Pure: a stable list of "key=value" for every field that counts. */
export function snapshotFields(root) {
  if (!root) return [];
  const out = [];
  root.querySelectorAll("input, select, textarea").forEach((el, i) => {
    if (el.matches(SKIP) || el.disabled) return;
    const key = el.name || el.id || `#${i}`;
    if (el.type === "checkbox" || el.type === "radio") out.push(`${key}[${el.value}]=${el.checked ? "1" : "0"}`);
    else out.push(`${key}=${el.value}`);
  });
  return out;
}

export function fieldsDiffer(a, b) {
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

export function useFormDirty(rootRef) {
  const [dirty, setDirty] = useState(false);
  const base = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    // After the first paint, so controlled defaults are in place.
    const t = setTimeout(() => { base.current = snapshotFields(root); }, 0);
    const check = () => {
      if (!base.current) return;
      setDirty(fieldsDiffer(base.current, snapshotFields(root)));
    };
    root.addEventListener("input", check);
    root.addEventListener("change", check);
    // Buttons that set a value (a toggle, a chip) change the form without an input event.
    const afterClick = () => setTimeout(check, 0);
    root.addEventListener("click", afterClick);
    return () => {
      clearTimeout(t);
      root.removeEventListener("input", check);
      root.removeEventListener("change", check);
      root.removeEventListener("click", afterClick);
    };
  }, [rootRef]);

  return dirty;
}
