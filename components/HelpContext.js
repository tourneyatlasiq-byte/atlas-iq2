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
const HelpContext = createContext({ qab: false, isAdmin: false, canWrite: false, phase: null });

/**
 * Also carries the person's access (H3), the same shape Help's actionState
 * uses on /help, so contextual answers never offer a button the person
 * can't complete. Unknown access fails closed.
 */
export function HelpContextProvider({ qab = false, isAdmin = false, canWrite = false, phase = null, children }) {
  const value = { qab: Boolean(qab), isAdmin: Boolean(isAdmin), canWrite: Boolean(canWrite), phase: phase ?? null };
  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export const useHelpContext = () => useContext(HelpContext);
