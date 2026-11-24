import { collect } from "./contract";
import { teamActions } from "./team";
import { tournamentActions } from "./tournaments";
import { financeActions } from "./finance";
import { featuredTournament } from "../featured-tournament";
import { utcDateIso } from "../local-date";

/**
 * Dashboard Needs Action roll-up.
 *
 * Deliberately imports the same rule functions the modules use rather than
 * restating them. A rule change lands everywhere at once; there is no
 * Dashboard-specific alert system to drift.
 *
 * Files contributes nothing on purpose — document requirements were deferred,
 * so there is no lib/readiness/files.js to call. Inventing one here would be
 * exactly the kind of Dashboard-only rule this pattern exists to prevent.
 */

const MODULES = {
  tournaments: { label: "Tournaments", href: "/tournaments" },
  team: { label: "Team", href: "/team" },
  finance: { label: "Finance", href: "/finance" },
};

/**
 * Plain language for Home.
 *
 * Home speaks the way a coach thinks; the modules keep their precise labels.
 * These are DISPLAY STRINGS ONLY — the rules that decide whether an action
 * fires are untouched and live in lib/readiness/*.js.
 *
 * Falls back to the module's own title when a rule has no phrasing here, so a
 * new rule shows up correctly rather than silently rendering blank.
 */
const PLAIN = {
  "team:registration": (n) =>
    `${n} ${n === 1 ? "player" : "players"} could use a date of birth`,
  "team:contact": (n) =>
    `${n} ${n === 1 ? "player has" : "players have"} no contact details`,

  "tournaments:deadline": (n) =>
    `${n} ${n === 1 ? "tournament closes" : "tournaments close"} for registration soon`,
  "tournaments:unregistered": (n) =>
    `${n} committed ${n === 1 ? "tournament isn't" : "tournaments aren't"} registered yet`,
  "tournaments:payment": (n) =>
    `${n} ${n === 1 ? "tournament isn't" : "tournaments aren't"} paid for yet`,
  "tournaments:waitlist": (n) =>
    `${n} ${n === 1 ? "tournament is" : "tournaments are"} still waitlisted`,
  "tournaments:decision": (n) =>
    `${n} ${n === 1 ? "tournament needs" : "tournaments need"} a decision`,

  "finance:outstanding": (n, a) => {
    const total = (a.affected ?? []).reduce((s2, p) => s2 + (p.balance ?? 0), 0);
    return `${n} ${n === 1 ? "player still owes" : "players still owe"} $${Math.round(total).toLocaleString()}`;
  },
  "finance:not-started": (n) =>
    `${n} ${n === 1 ? "player hasn't" : "players haven't"} paid anything yet`,
};

/** Turns a readiness action into the sentence Home shows. */
export function plainLanguage(a) {
  const fn = PLAIN[a.id];
  return fn ? fn(a.affected?.length ?? 0, a) : a.title;
}

/** How many actions the Dashboard shows before routing back to the modules. */
export const DASHBOARD_ACTION_LIMIT = 6;

export function dashboardActions({ roster, tournaments, payments, transactions = [] }) {
  const decorate = (actions, moduleKey) =>
    actions.map((a) => ({
      ...a,
      id: `${moduleKey}:${a.id}`,
      module: MODULES[moduleKey].label,
      href: MODULES[moduleKey].href,
      moduleKey,
    }));

  const all = collect([
    ...decorate(tournamentActions(tournaments ?? [], new Date(), transactions ?? []), "tournaments"),
    ...decorate(teamActions(roster ?? []), "team"),
    ...decorate(
      financeActions(
        payments ?? [],
        // Active players only — pickups and staff don't owe season dues.
        (roster ?? []).filter(
          (r) => r.is_active && (r.player?.person_type ?? "player") === "player"
        )
      ),
      "finance"
    ),
  ]).sort(
    (a, b) => a.priority - b.priority || a.module.localeCompare(b.module) || a.title.localeCompare(b.title)
  );

  return {
    // Every action, for Home to filter before limiting (the next weekend's
    // own items move to its card). Same rules, same order.
    all,
    visible: all.slice(0, DASHBOARD_ACTION_LIMIT),
    total: all.length,
    hidden: Math.max(0, all.length - DASHBOARD_ACTION_LIMIT),
    // Modules with something outstanding but no room on the list.
    overflowModules: [
      ...new Set(all.slice(DASHBOARD_ACTION_LIMIT).map((a) => a.module)),
    ],
  };
}

/**
 * The featured tournament for the server's first render.
 *
 * The rule itself lives in lib/featured-tournament.js and is shared with the
 * browser, which re-applies it with the device's own date (the server only
 * knows UTC). Kept under this name for the pages that already call it.
 */
export function nextUpTournament(tournaments, today = new Date()) {
  return featuredTournament(tournaments, utcDateIso(today));
}
