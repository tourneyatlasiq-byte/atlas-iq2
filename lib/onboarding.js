/**
 * Travel softball runs roughly August to July, so the season label turns over
 * in August rather than in January.
 *
 *   Aug 2026 -> "2026-27"     Feb 2027 -> "2026-27"     Jul 2026 -> "2025-26"
 */
export function currentSeasonLabel(now = new Date()) {
  const year = now.getFullYear();
  const startYear = now.getMonth() >= 7 ? year : year - 1; // month 7 = August
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * Season options for setup: the current season plus one either side.
 *
 * Derived from currentSeasonLabel() so there is no second definition of which
 * season is current. Preserves the canonical YYYY-YY format used throughout
 * Atlas and matched by the database when deriving start_date.
 */
export function seasonOptions(now = new Date()) {
  const current = currentSeasonLabel(now);
  const startYear = Number(current.slice(0, 4));
  const label = (y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  return [label(startYear - 1), current, label(startYear + 1)];
}

/**
 * Getting started, and the plain-English help copy used across Atlas.
 *
 * Pure — no server imports — so pages and client components can both use it.
 *
 * Step completion is derived from real data. There is no stored progress and
 * nothing to keep in sync: if a coach adds a tournament, that step is done.
 * The only thing stored anywhere is whether the card has been dismissed.
 */

/**
 * The five things worth doing first.
 *
 * Each one launches a workflow that already exists. Nothing here is an
 * onboarding-only screen.
 */
/**
 * The next incomplete step, for orientation after an action completes on
 * another page. Returns null once setup is done.
 */
export function nextStep(steps) {
  return steps.find((s) => !s.done && s.href) ?? null;
}

/** True when every step is complete — drives the completion state. */
export function setupComplete(steps) {
  return steps.length > 0 && steps.every((s) => s.done);
}

export function gettingStartedSteps({
  teamNamed,
  seasonNamed,
  rosterCount,
  tournamentCount,
  duesCount,
  teamName,
  seasonName,
}) {
  return [
    {
      id: "name-team",
      title: "Confirm your team and season",
      done: teamNamed && seasonNamed,
      detail: teamNamed && seasonNamed ? `${teamName} · ${seasonName}` : "Named during setup",
      // No action: this is set during setup and Settings is read-only. If it
      // can ever legitimately become incomplete, Settings needs editing first.
      href: null,
      cta: null,
    },
    {
      id: "roster",
      title: "Add your roster",
      done: rosterCount > 0,
      detail:
        rosterCount > 0
          ? `${rosterCount} ${rosterCount === 1 ? "person" : "people"} added`
          : "Players, coaches and team staff",
      href: "/team",
      cta: "Go to Team",
    },
    {
      id: "tournament",
      title: "Add your first tournament",
      done: tournamentCount > 0,
      detail:
        tournamentCount > 0
          ? `${tournamentCount} on the schedule`
          : "Even one you're only considering",
      href: "/tournaments",
      cta: "Go to Tournaments",
    },
    {
      id: "dues",
      title: "Set what players owe",
      done: duesCount > 0,
      detail:
        duesCount > 0
          ? `${duesCount} ${duesCount === 1 ? "player" : "players"} set up`
          : "Season fees for each player",
      href: "/finance?tab=player-payments",
      cta: "Set player dues",
    },
  ];
}

/** Module descriptions. Why you would open it, not what it contains. */
export const MODULE_DESCRIPTIONS = {
  dashboard: "See what is coming up, what needs attention, and where your team stands.",
  tournaments:
    "Plan your tournament schedule, compare options, and track registrations, costs, games, and results.",
  team: "Manage your roster, coaches, uniforms, contacts, and player information for the season.",
  facilities:
    "Know where you’re playing and what your team needs to know when you get there.",
  finance: "Track your team budget, expenses, money received, and player dues.",
  files: "Keep team, player, and tournament documents organized in one place.",
};

/** One sentence per term a first-time user may not recognise. */
export const TERMS = {
  Considering: "You're weighing this up. It doesn't count toward your budget yet.",
  Committed:
    "On a tournament, you're going and costs start counting. On an expense, it's ordered or received but not yet paid.",
  Declined: "You looked at it and decided against it. Kept so you can see it again next year.",
  Waitlisted: "You've registered but don't have a place yet.",
  "Registration and payment":
    "Separate on purpose. \"Are we going?\" is your decision; this is where the paperwork stands. It's normal to be committed before you've registered.",
  "Money In": "Money received: player dues, fundraising and sponsors. Kept separate from spending.",
  "Player Payments": "What each family owes for the season, and what they've paid so far.",
  "Our Facilities": "Places you've played or written notes about. Everything else is under All facilities.",
  "Needs Action": "Things worth doing now. When it's empty, you're up to date.",
};
