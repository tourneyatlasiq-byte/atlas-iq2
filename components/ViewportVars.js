"use client";

import { useEffect } from "react";

/**
 * Publishes the part of the screen a person can actually see as two CSS
 * variables, --vv-h and --vv-top.
 *
 * On a phone the on-screen keyboard covers the bottom of the page without
 * changing the layout's height, so a drawer or dialog sized to 100% of the
 * screen keeps its Save and Cancel buttons underneath the keyboard. The
 * visual viewport is the area left above the keyboard; overlays sized to it
 * keep their header, close control and actions on screen while typing.
 *
 * Presentation only. Nothing reads these values but CSS, and browsers without
 * visualViewport fall back to the 100dvh default in the stylesheet.
 */
export function ViewportVars() {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return undefined;
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      frame = 0;
      root.style.setProperty("--vv-h", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vv-top", `${Math.max(0, Math.round(vv.offsetTop))}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-top");
    };
  }, []);
  return null;
}
