/**
 * Screens on the Volt design system (approved 2026-11-18), applied group by
 * group: Home, Tournaments and Finance first, then Team, then Performance and
 * the game tracker (2026-11-19). Every Volt rule in app/volt.css is scoped under
 * `html.volt`, so other screens look exactly as before.
 * Presentation only.
 */
export const VOLT_PATHS = ["/dashboard", "/tournaments", "/finance", "/team", "/performance"];

/**
 * The game tracker has a dynamic path, so it is matched by shape rather than
 * listed: /tournaments/<id>/games/<id>/track. Nothing else under /tournaments
 * (detail pages, lineup) changes.
 */
export const VOLT_PATTERNS = [/^\/tournaments\/[^/]+\/games\/[^/]+\/track$/];

export function isVoltPath(pathname) {
  const p = String(pathname || "").replace(/\/$/, "");
  return VOLT_PATHS.includes(p) || VOLT_PATTERNS.some((re) => re.test(p));
}

/** Runs inline in the app shell, before first paint. Same rule as isVoltPath. */
export const VOLT_BOOT = `(function(){var p=location.pathname.replace(/\\/$/,"");var L=${JSON.stringify(
  VOLT_PATHS
)};var R=[${VOLT_PATTERNS.map((re) => re.toString()).join(",")}];if(L.indexOf(p)>-1||R.some(function(r){return r.test(p)}))document.documentElement.classList.add("volt");})();`;
