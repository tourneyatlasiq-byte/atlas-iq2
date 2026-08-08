/**
 * In-app help.
 *
 * Every task names what it does, in one sentence, and its button says where it
 * goes. Where the interface can open the actual form we link straight to it;
 * where it can't, the sentence says why rather than implying an action that
 * doesn't exist.
 *
 * `direct: true` means the link opens the form or tab itself.
 * `direct: false` means it opens the page and the user picks a record first.
 *
 * Keywords are the words a coach would actually type — "kid", "receipt",
 * "owe" — not the words the interface uses.
 */

export const HELP_GROUPS = [
  {
    id: "team",
    label: "Team",
    tasks: [
      {
        id: "add-player",
        title: "Add a player",
        text: "Add someone to your roster.",
        href: "/team?add=person",
        cta: "Add person",
        direct: true,
        keywords: "roster kid girl athlete new signup join jersey",
      },
      {
        id: "add-coach",
        title: "Add a coach or manager",
        text: "Add team staff, not a player.",
        href: "/team?add=person",
        cta: "Add person",
        direct: true,
        keywords: "staff assistant helper adult volunteer",
      },
      {
        id: "update-player",
        title: "Update player information",
        text: "Jersey, sizes, contacts and positions.",
        href: "/team",
        cta: "Go to Team",
        direct: false,
        keywords: "edit change jersey size uniform phone email parent position",
      },
    ],
  },
  {
    id: "tournaments",
    label: "Tournaments",
    tasks: [
      {
        id: "add-tournament",
        title: "Add a tournament",
        text: "A name and a date is enough to start.",
        href: "/tournaments?add=1",
        cta: "Add tournament",
        direct: true,
        keywords: "event schedule weekend tourney comp entry",
      },
      {
        id: "record-game",
        title: "Record a game",
        text: "Games live inside each tournament — open one first.",
        href: "/tournaments",
        cta: "Go to Tournament IQ",
        direct: false,
        keywords: "score result won lost win loss record opponent bracket pool",
      },
      {
        id: "update-registration",
        title: "Update registration or payment",
        text: "Mark an event registered, waitlisted or paid.",
        href: "/tournaments",
        cta: "Go to Tournament IQ",
        direct: false,
        keywords: "registered waitlist paid deposit entry fee status",
      },
      {
        id: "commit-tournament",
        title: "Commit to a tournament",
        text: "Move it from Considering to Committed.",
        href: "/tournaments",
        cta: "Go to Tournament IQ",
        direct: false,
        keywords: "commit going decide considering declined confirm",
      },
    ],
  },
  {
    id: "money",
    label: "Money",
    tasks: [
      {
        id: "set-dues",
        title: "Set player dues",
        text: "Set what each player owes for the season.",
        href: "/finance?tab=player-payments",
        cta: "Open Player Payments",
        direct: true,
        keywords: "dues fees owe cost per player season charge",
      },
      {
        id: "record-payment",
        title: "Record a player payment",
        text: "Log money received from a family.",
        href: "/finance?tab=player-payments",
        cta: "Open Player Payments",
        direct: true,
        keywords: "paid payment cash check venmo received parent money in",
      },
      {
        id: "add-expense",
        title: "Add an expense",
        text: "Record a team purchase or bill.",
        href: "/finance?tab=transactions&add=1",
        cta: "Add transaction",
        direct: true,
        keywords: "expense receipt bill cost spend bought purchase invoice",
      },
      {
        id: "add-income",
        title: "Record fundraising or sponsorship",
        text: "Money in that isn't player dues.",
        href: "/finance?tab=transactions&add=1",
        cta: "Add transaction",
        direct: true,
        keywords: "fundraiser sponsor donation income raised money in",
      },
      {
        id: "build-budget",
        title: "Build your budget",
        text: "Plan what you expect to spend.",
        href: "/finance?tab=budget",
        cta: "Open Budget",
        direct: true,
        keywords: "budget plan categories line items estimate",
      },
      {
        id: "whos-owed",
        title: "See what's still owed",
        text: "Who has paid and who hasn't.",
        href: "/finance?tab=player-payments",
        cta: "Open Player Payments",
        direct: true,
        keywords: "outstanding balance owed unpaid behind chase",
      },
    ],
  },
  {
    id: "places",
    label: "Facilities & Files",
    tasks: [
      {
        id: "find-facility",
        title: "Find a facility",
        text: "Search by name, city or county.",
        href: "/facilities?view=all",
        cta: "Browse all facilities",
        direct: true,
        keywords: "venue field park complex where playing directions address",
      },
      {
        id: "facility-notes",
        title: "Save facility notes",
        text: "Open a venue, then add parking and gate notes.",
        href: "/facilities",
        cta: "Go to Facilities",
        direct: false,
        keywords: "parking gate concessions restroom shade notes remember",
      },
      {
        id: "add-facility",
        title: "Add a facility",
        text: "The venue isn't in Atlas yet.",
        href: "/facilities?add=1",
        cta: "Add facility",
        direct: true,
        keywords: "new venue missing not listed create park",
      },
      {
        id: "upload-document",
        title: "Upload a document",
        text: "Attach it to a player or tournament.",
        href: "/files?upload=1",
        cta: "Upload file",
        direct: true,
        keywords: "birth certificate waiver insurance schedule pdf photo paperwork form",
      },
    ],
  },
  {
    id: "seasons",
    label: "Seasons & Access",
    tasks: [
      {
        id: "new-season",
        title: "Start a new season",
        text: "Carry your roster into next year.",
        href: "/settings?new-season=1",
        cta: "Start next season",
        direct: true,
        keywords: "next year rollover 2027 new season roll over",
      },
      {
        id: "view-season",
        title: "View a previous season",
        text: "Use the season menu at the top of the page.",
        href: null,
        cta: null,
        direct: false,
        keywords: "last year history past previous old season switch",
      },
      {
        id: "invite",
        title: "Invite someone to Atlas",
        text: "Add a coach, manager or parent.",
        href: "/settings?invite=1",
        cta: "Invite someone",
        direct: true,
        keywords: "invite add user access permission share account",
      },
      {
        id: "rename",
        title: "Rename your team or season",
        text: "Fix a name you typed during setup.",
        href: "/settings",
        cta: "Go to Settings",
        direct: false,
        keywords: "rename change name typo spelling team organization",
      },
    ],
  },
];

const ALL_TASKS = HELP_GROUPS.flatMap((g) => g.tasks);

export const findTask = (id) => ALL_TASKS.find((t) => t.id === id) ?? null;

/**
 * What's worth doing on the page you're already looking at.
 *
 * Dashboard is deliberately absent — it is already a set of links, and
 * repeating them here would be noise.
 */
const ON_THIS_PAGE = {
  "/tournaments": ["add-tournament", "record-game", "commit-tournament"],
  "/team": ["add-player", "add-coach", "upload-document"],
  "/facilities": ["find-facility", "facility-notes", "add-facility"],
  "/finance": ["set-dues", "add-expense", "build-budget"],
  "/files": ["upload-document"],
  "/settings": ["invite", "new-season", "rename"],
};

export function tasksForPath(pathname) {
  const key = Object.keys(ON_THIS_PAGE).find((p) => pathname.startsWith(p));
  return key ? ON_THIS_PAGE[key].map(findTask).filter(Boolean) : [];
}

/** Matches title, sentence and the words a coach would actually type. */
export function searchTasks(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const terms = q.split(/\s+/);
  return HELP_GROUPS.map((g) => ({
    ...g,
    tasks: g.tasks.filter((t) => {
      const haystack = `${t.title} ${t.text} ${t.keywords}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }),
  })).filter((g) => g.tasks.length > 0);
}
