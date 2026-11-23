/**
 * Where a report's Back link goes (2026-11).
 *
 * A report is a separate screen reached from several places (Finance, the
 * Reports hub, later Performance). Back returns to the screen the coach came
 * from. The origin travels in the address as ?from=<name>, so a refresh or a
 * bookmark keeps the same Back and nothing can go stale. Nothing is stored in
 * the browser, which is the failure class Release 2b had to close for game pages.
 *
 * Rules, from the Release 2 Back work:
 *  - Only the names in REPORT_BACK_TARGETS are accepted. Anything else (missing,
 *    unknown, another case, a URL, a path, a repeated parameter that does not
 *    start with a known name) falls back to the Reports hub. No address is ever
 *    taken from the request.
 *  - Back is always a normal link. Browser history is never used, so it cannot
 *    dead-end or leave Season Tempo.
 */
export const REPORT_BACK_TARGETS = Object.freeze({
  reports: Object.freeze({ href: "/reports", label: "Reports" }),
  finance: Object.freeze({ href: "/finance", label: "Finance" }),
  performance: Object.freeze({ href: "/performance", label: "Performance" }),
  team: Object.freeze({ href: "/team", label: "Team" }),
});

const DEFAULT_NAME = "reports";

function firstName(from) {
  const v = Array.isArray(from) ? from[0] : from;
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(REPORT_BACK_TARGETS, v) ? v : null;
}

/** The checked Back target for a ?from value. Always returns one. */
export function reportBack(from) {
  const name = firstName(from) ?? DEFAULT_NAME;
  const { href, label } = REPORT_BACK_TARGETS[name];
  return { href, label };
}

/** The allowed origin name to carry forward, or null (the default needs no parameter). */
export function fromParam(from) {
  const name = firstName(from);
  return name && name !== DEFAULT_NAME ? name : null;
}

/** A report address that keeps the origin. Unknown or missing origin leaves it unchanged. */
export function withFrom(path, from) {
  const name = fromParam(from);
  if (!name) return path;
  return `${path}${path.includes("?") ? "&" : "?"}from=${name}`;
}
