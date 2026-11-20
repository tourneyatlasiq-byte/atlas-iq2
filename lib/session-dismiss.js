/**
 * "Not now" for optional suggestions (Release 2).
 *
 * Lasts for the browser session: sessionStorage survives leaving the screen,
 * coming back and refreshing, and is gone when the tab closes. It is never the
 * database and holds only the flag "1", no names or other data. Every call is
 * safe when storage is missing or refuses access (private modes, server
 * render): the suggestion then simply shows, it never throws.
 */
export const dismissKey = (kind, id) => `st-notnow:${kind}:${id}`;

export function isDismissed(storage, key) {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function dismiss(storage, key) {
  try {
    storage?.setItem(key, "1");
  } catch {
    /* nothing to do: the suggestion just returns next visit */
  }
}
