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
 * trusted again only for a refresh of the same page, once per page load. A page
 * opened any other way (a bookmark, a link from elsewhere, a return after other
 * pages, a refresh somewhere else) finds the record already claimed, treats it
 * as stale, and drops it. Home
 * clears the record whenever it shows. Anything missing or unreadable means
 * "not from Home": Home then just opens at the top.
 */
const KEY = "st-entry-from";

export function markEntry(storage, from, href) {
  try { storage?.setItem(KEY, JSON.stringify({ from, href, claimed: false })); } catch { /* ignore */ }
}

/**
 * What the page can say about its own document: how it was loaded ("reload" for
 * a refresh), the address it was loaded at, and an id that is unique to this
 * load. The load type and address never change while the page stays open and
 * the coach moves around inside the app, which is why claimEntry cannot rely on
 * the type alone.
 */
export function readNavigation(perf) {
  try {
    const e = perf?.getEntriesByType?.("navigation")?.[0];
    let docUrl = null;
    try { const u = new URL(e?.name); docUrl = u.pathname + u.search; } catch { /* unknown */ }
    return { type: e?.type, docUrl, docId: perf?.timeOrigin };
  } catch {
    return {};
  }
}

/**
 * Called when a game page shows. True when this page was really entered from
 * Home just now (first claim) or is a refresh of that same page. Side effect: a
 * fresh record is marked claimed; a stale one is removed.
 *
 * `nav` comes from readNavigation. After the first claim the record is trusted
 * again only for a genuine refresh: the load type is "reload", the document was
 * loaded at THIS page (not at some other page the coach later left for this
 * one), and this document has not already used the refresh. The last rule is
 * what stops "refresh, visit another page, come back" from being trusted: the
 * load type stays "reload" for the whole life of the document.
 */
export function claimEntry(storage, from, currentHref, nav) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return false;
    const v = JSON.parse(raw);
    if (v?.from !== from || v?.href !== currentHref) return false;
    const docId = nav?.docId;
    const hasDoc = typeof docId === "number" && Number.isFinite(docId);
    if (!v.claimed) {
      storage.setItem(KEY, JSON.stringify({ ...v, claimed: true, doc: hasDoc ? docId : null }));
      return true;
    }
    if (nav?.type === "reload" && nav?.docUrl === currentHref && hasDoc && v.doc !== docId) {
      storage.setItem(KEY, JSON.stringify({ ...v, doc: docId }));
      return true;
    }
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
