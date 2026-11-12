"use client";

import { createContext, useContext } from "react";

/**
 * What Help may assume about the signed-in organization (2026-11).
 *
 * Provided once by the app layout from the same `features` it already reads
 * for the navigation, so the Help popover on any screen knows whether QAB is
 * on without each page passing it down. Presentation only: RLS and the
 * feature gate still decide what anyone can read or write.
 *
 * Without a provider, QAB is treated as off, so Help never knowingly offers
 * QAB questions it can't stand behind.
 */
const HelpContext = createContext({ qab: false });

export function HelpContextProvider({ qab = false, children }) {
  return <HelpContext.Provider value={{ qab: Boolean(qab) }}>{children}</HelpContext.Provider>;
}

export const useHelpContext = () => useContext(HelpContext);
