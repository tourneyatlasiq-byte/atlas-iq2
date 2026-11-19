"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "../lib/finance-rules";

/**
 * A figure that moves to its new value after a save.
 *
 * The first render shows the value as it is; only later changes animate, so a
 * page load never "counts up" from zero. Off under reduced motion. The final
 * frame is always the exact value, never a rounded intermediate.
 *
 * format: "money" | "int" | "pct" | "split" (dollars with small cents)
 */
export function CountUp({ value, format = "money", className }) {
  const n = Number(value ?? 0);
  const [shown, setShown] = useState(n);
  const prev = useRef(n);
  useEffect(() => {
    const from = prev.current;
    prev.current = n;
    if (from === n) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(n); return; }
    let raf;
    const t0 = performance.now();
    const step = (t) => {
      const q = Math.min(1, (t - t0) / 650);
      const e = 1 - Math.pow(1 - q, 3);
      setShown(q < 1 ? from + (n - from) * e : n);
      if (q < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [n]);

  if (format === "int") return <span className={className}>{Math.round(shown)}</span>;
  if (format === "pct") return <span className={className}>{Math.round(shown)}%</span>;
  if (format === "split") {
    const s = money(Math.round(shown * 100) / 100);
    const i = s.lastIndexOf(".");
    return <span className={className}>{s.slice(0, i)}<small>{s.slice(i)}</small></span>;
  }
  return <span className={className}>{money(Math.round(shown * 100) / 100)}</span>;
}
