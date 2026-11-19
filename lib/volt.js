/**
 * Screens on the Volt design system (approved 2026-11-18), applied group by
 * group: Home, Tournaments and Finance first. Every Volt rule in app/volt.css
 * is scoped under `html.volt`, so other screens look exactly as before.
 * Presentation only.
 */
export const VOLT_PATHS = ["/dashboard", "/tournaments", "/finance", "/team"];

/** Runs inline in the app shell, before first paint. */
export const VOLT_BOOT = `(function(){var p=location.pathname.replace(/\\/$/,"");if(${JSON.stringify(
  VOLT_PATHS
)}.indexOf(p)>-1)document.documentElement.classList.add("volt");})();`;
