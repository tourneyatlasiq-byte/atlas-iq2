/**
 * Back from a game page opened from Home (Release 2, revised after the live pass).
 *
 * The Back link is ALWAYS a normal link to Home. Browser history is never used
 * for it: history cannot prove what the previous page is, and Save Lineup adds
 * a same-page history entry, which turned "history Back" into a dead end. A
 * normal link cannot dead-end and cannot leave the app.
 *
 * What the record below decides is only whether Home should put its scroll
 * position back. Home's own link records the destination when tapped. The game
 * page then "claims" that record once, on arrival. After that the record is
 * trusted again only for a refresh of the same page. A page opened any other
 * way (a bookmark, a link from elsewhere, a later visit after other pages)
 * finds the record already claimed, treats it as stale, and drops it. Home
 * clears the record whenever it shows. Anything missing or unreadable means
 * "not from Home": Home then just opens at the top.
 */
const KEY = "st-entry-from";

export function markEntry(storage, from, href) {
  try { storage?.setItem(KEY, JSON.stringify({ from, href, claimed: false })); } catch { /* ignore */ }
}

/**
 * Called when a game page shows. True when this page was really entered from
 * Home just now (first claim) or is a refresh of that same page. `navType` is
 * the document load type ("reload" for a refresh). Side effect: a fresh record
 * is marked claimed; a stale one is removed.
 */
export function claimEntry(storage, from, currentHref, navType) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return false;
    const v = JSON.parse(raw);
    if (v?.from !== from || v?.href !== currentHref) return false;
    if (!v.claimed) {
      storage.setItem(KEY, JSON.stringify({ ...v, claimed: true }));
      return true;
    }
    if (navType === "reload") return true;
    storage.removeItem(KEY);
    return false;
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

const RESTORE = "st-back-restore";

/** The Back link was tapped on a page trusted to have come from Home: ask Home to restore its scroll. */
export function markBackTap(storage) {
  try { storage?.setItem(RESTORE, "1"); } catch { /* ignore */ }
}

/**
 * When Home shows: the saved scroll position, but only if the Back link asked
 * for it. Both records are always spent, so a later visit to Home (sidebar, a
 * bookmark) never jumps to an old position.
 */
export function takeBackScroll(storage) {
  let asked = false;
  try {
    asked = storage?.getItem(RESTORE) === "1";
    storage?.removeItem(RESTORE);
  } catch { /* ignore */ }
  const y = takeScroll(storage);
  return asked ? y : null;
}
