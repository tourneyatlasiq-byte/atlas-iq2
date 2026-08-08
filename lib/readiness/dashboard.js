import { collect } from "./contract";
import { teamActions } from "./team";
import { tournamentActions } from "./tournaments";
import { financeActions } from "./finance";

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
  tournaments: { label: "Tournament IQ", href: "/tournaments" },
  team: { label: "Team", href: "/team" },
  finance: { label: "Finance", href: "/finance" },
};

/** How many actions the Dashboard shows before routing back to the modules. */
export const DASHBOARD_ACTION_LIMIT = 6;

export function dashboardActions({ roster, tournaments, payments }) {
  const decorate = (actions, moduleKey) =>
    actions.map((a) => ({
      ...a,
      id: `${moduleKey}:${a.id}`,
      module: MODULES[moduleKey].label,
      href: MODULES[moduleKey].href,
      moduleKey,
    }));

  const all = collect([
    ...decorate(tournamentActions(tournaments ?? []), "tournaments"),
    ...decorate(teamActions(roster ?? []), "team"),
    ...decorate(financeActions(payments ?? []), "finance"),
  ]).sort(
    (a, b) => a.priority - b.priority || a.module.localeCompare(b.module) || a.title.localeCompare(b.title)
  );

  return {
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
 * The next committed tournament that has not yet finished.
 *
 * Committed only: a tournament still under consideration is not "what's
 * happening next", and a declined one certainly isn't.
 */
export function nextUpTournament(tournaments, today = new Date()) {
  const iso = today.toISOString().slice(0, 10);

  const upcoming = (tournaments ?? [])
    .filter((t) => t.decision === "Committed" && (t.end_date ?? t.start_date) >= iso)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));

  const next = upcoming[0] ?? null;
  if (!next) return null;

  const days = Math.ceil(
    (new Date(next.start_date + "T00:00:00") - new Date(iso + "T00:00:00")) / 86400000
  );

  return { tournament: next, daysAway: days };
}
