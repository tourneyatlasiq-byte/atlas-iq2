/**
 * Direct entry links from other screens into a tournament task (2026-11).
 *
 * "Link a venue" on Locations used to open the tournament drawer and leave the
 * coach to find the venue field. It now arrives with the venue picker already
 * open, and cancelling or saving returns to the screen they started on.
 *
 *   /tournaments?open=<id>&action=venue|resource|contact&return=<internal path>
 *
 * `return` is only ever an internal path from a short allowlist, so the link can
 * never be turned into an open redirect.
 */
export const ENTRY_ACTIONS = ["venue", "resource", "contact"];
const RETURN_ALLOWLIST = ["/facilities"];

/** The path if it is a safe internal return target, otherwise null. */
export function safeReturnPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  const pathOnly = value.split(/[?#]/)[0];
  return RETURN_ALLOWLIST.includes(pathOnly) ? value : null;
}

/** Builds the link. Unknown actions fall back to the plain drawer link. */
export function entryHref(tournamentId, action, returnTo = null) {
  const q = new URLSearchParams({ open: tournamentId });
  if (ENTRY_ACTIONS.includes(action)) q.set("action", action);
  const back = safeReturnPath(returnTo);
  if (back && q.has("action")) q.set("return", back);
  return `/tournaments?${q.toString()}`;
}

/** Reads the entry request from URLSearchParams-like input. */
export function parseEntry(params) {
  const get = (k) => (typeof params?.get === "function" ? params.get(k) : null);
  const action = get("action");
  return {
    action: ENTRY_ACTIONS.includes(action) ? action : null,
    returnTo: safeReturnPath(get("return")),
  };
}
