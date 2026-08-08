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
export function gettingStartedSteps({
  teamNamed,
  seasonNamed,
  rosterCount,
  tournamentCount,
  duesCount,
  facilityNoteCount,
  teamName,
  seasonName,
}) {
  return [
    {
      id: "name-team",
      title: "Confirm your team and season",
      done: teamNamed && seasonNamed,
      detail: teamNamed && seasonNamed ? `${teamName} · ${seasonName}` : "Set up in Settings",
      href: "/settings",
      cta: "Open settings",
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
      cta: "Go to Tournament IQ",
    },
    {
      id: "dues",
      title: "Set what players owe",
      done: duesCount > 0,
      detail:
        duesCount > 0
          ? `${duesCount} ${duesCount === 1 ? "player" : "players"} set up`
          : "Season fees for each player",
      href: "/finance",
      cta: "Go to Finance",
    },
    {
      id: "facility",
      title: "Save a venue you'll return to",
      done: facilityNoteCount > 0,
      detail:
        facilityNoteCount > 0
          ? `${facilityNoteCount} with your notes`
          : "Parking, gates, concessions — what you'll want next time",
      href: "/facilities",
      cta: "Go to Facilities",
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
    "Look up where you're playing, and keep the notes your team will want next time: parking, gates, concessions.",
  finance: "Track your team budget, expenses, money received, and player dues.",
  files: "Keep team, player, and tournament documents organized in one place.",
};

/**
 * "How do I…?" — one short answer each, and a link that lands on the right
 * screen. Start a new season is listed as unavailable rather than hidden,
 * because a missing option reads as a broken feature.
 */
export const HOW_DO_I = [
  {
    q: "Add a player",
    a: "Team → Add person. Search first — someone who played for you before is already here.",
    href: "/team",
  },
  {
    q: "Add a tournament",
    a: "Tournament IQ → Add tournament. A name and a date is enough to start.",
    href: "/tournaments",
  },
  {
    q: "Record games",
    a: "Open the tournament, scroll to Games, then Add game. Enter the score and the result works itself out.",
    href: "/tournaments",
  },
  {
    q: "Track dues",
    a: "Finance → Player Payments. Set what each player owes, then record payments as they come in.",
    href: "/finance",
  },
  {
    q: "Add an expense",
    a: "Finance → Transactions → Add transaction. Link it to a budget line to see it in your budget.",
    href: "/finance",
  },
  {
    q: "Find a facility",
    a: "Facilities → All facilities. Search by name, city or county.",
    href: "/facilities",
  },
  {
    q: "Upload a document",
    a: "Files → Upload file. Attach it to a player or tournament and it shows up there too.",
    href: "/files",
  },
  {
    q: "Start a new season",
    a: "Not available yet. Seasons are set up for you for now.",
    href: null,
  },
];

/** One sentence per term a first-time user may not recognise. */
export const TERMS = {
  Considering: "You're weighing this up. It doesn't count toward your budget yet.",
  Committed: "You're going. Costs and reminders start counting from here.",
  Declined: "You looked at it and decided against it. Kept so you can see it again next year.",
  Waitlisted: "You've registered but don't have a place yet.",
  "Funds In": "Money coming in: player dues, fundraising and sponsors. Kept separate from spending.",
  "Player Payments": "What each family owes for the season, and what they've paid so far.",
  "Our Venues": "Places you've played or written notes about. Everything else is under All facilities.",
  "Needs Action": "Things worth doing now. When it's empty, you're up to date.",
};
