"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

import { VOLT_PATHS } from "../lib/volt";

/**
 * Keeps the Volt class right during client navigation (see lib/volt.js).
 * The app shell sets it before first paint with VOLT_BOOT.
 */
export function VoltScope() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    const p = (pathname || "").replace(/\/$/, "");
    document.documentElement.classList.toggle("volt", VOLT_PATHS.includes(p));
  }, [pathname]);
  return null;
}
