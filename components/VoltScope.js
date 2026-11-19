"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

import { isVoltPath } from "../lib/volt";

/**
 * Keeps the Volt class right during client navigation (see lib/volt.js).
 * The app shell sets it before first paint with VOLT_BOOT.
 */
export function VoltScope() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("volt", isVoltPath(pathname));
  }, [pathname]);
  return null;
}
