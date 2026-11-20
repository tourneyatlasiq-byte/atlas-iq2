/**
 * Knowing whether history Back leads to Home (Release 2).
 *
 * A game page opened from Home carries ?from=home. Going back in history is
 * right only when the previous entry really is Home inside this app: that is
 * what restores Home at the same scroll position. A page opened by a direct
 * link (a bookmark, an email, a new tab) can have a history whose previous
 * entry is outside the app, so Back there could leave Season Tempo.
 *
 * Home's own link records the destination in sessionStorage when tapped; the
 * destination trusts history Back only if that record names this exact page.
 * Home clears the record whenever it shows. Anything missing or unreadable
 * means "not from the app": the caller then uses a normal link to Home.
 */
const KEY = "st-entry-from";

export function markEntry(storage, from, href) {
  try { storage?.setItem(KEY, JSON.stringify({ from, href })); } catch { /* ignore */ }
}

export function cameFromApp(storage, from, currentHref) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return false;
    const v = JSON.parse(raw);
    return v?.from === from && v?.href === currentHref;
  } catch {
    return false;
  }
}

export function clearEntry(storage) {
  try { storage?.removeItem(KEY); } catch { /* ignore */ }
}

const SCROLL = "st-home-scroll";

/** Remember how far Home was scrolled when a game was opened from it. */
export function saveScroll(storage, y) {
  try {
    const n = Math.round(Number(y));
    if (Number.isFinite(n) && n > 0) storage?.setItem(SCROLL, String(n));
  } catch { /* ignore */ }
}

/**
 * The saved position, once. Used when Home shows again: history Back can
 * restore it in the same page session, but not after a refresh, which is why
 * it is kept here as well. Garbage or missing means "leave the page alone".
 */
export function takeScroll(storage) {
  try {
    const raw = storage?.getItem(SCROLL);
    storage?.removeItem(SCROLL);
    const n = Number(raw);
    return raw && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}
