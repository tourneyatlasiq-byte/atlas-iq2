/**
 * Help & Getting Started guides (V1, 2026-11).
 *
 * Nine guides, each written around something a coach is trying to get done,
 * not around a feature name. Kept deliberately short: a guide answers "what do
 * I do next?", it is not documentation.
 *
 *   steps       3 to 7, each a title, one or two sentences, and at most one
 *               action. Step ids are the anchors used by Help links
 *               (/help/qab#correct).
 *   pieces      an optional "how these fit together" block of short terms.
 *   goodToKnow  the mistakes coaches actually make, 1 to 4 lines.
 *   keywords    the words a coach would actually type ("venmo", "mom",
 *               "lineup"), used only by Help search.
 *
 * Permission wording describes access ("anyone with access to Finance"),
 * not today's role list, so it stays true when per-person access arrives.
 *
 * Actions:
 *   href       where the button goes. A /help/... href is a link to another
 *              guide; anything else opens the product screen.
 *   requires   "admin" (organization owner), "write" (anyone who can change
 *              team data) or "qab" (Performance turned on). Help never offers
 *              an action the person can't complete; it says why instead
 *              (see actionState in lib/help.js).
 *   creates    true when the action adds a record, so it is held back while a
 *              past, read-only season is being viewed.
 *
 * Pure data — no imports — so the server pages, the Help panel and the check
 * scripts all read the same content.
 */

/** "On the roster" is not "can sign in". Shown wherever the two get confused. */
const ROSTER_VS_ACCESS = {
  title: "On the roster vs. Season Tempo access",
  items: [
    {
      term: "On the roster",
      text: "Players, coaches and staff on your team list. Adding someone here does not give them a login.",
    },
    {
      term: "Season Tempo access",
      text: "A login to use Season Tempo. Organization owners send an invitation from Settings.",
    },
  ],
};

export const HELP_GUIDES = [
  {
    slug: "setup",
    title: "Set up your team and season",
    summary: "New to Season Tempo? Start here. Go from a new account to a team that's ready for the season.",
    keywords: "start begin new account setup checklist rename name season year rollover next previous last",
    who: "Most steps are available to team members with access to those areas. Renaming and starting a new season are organization owner tasks.",
    steps: [
      {
        id: "names",
        title: "Check your team and season names",
        text: "They were set when you signed up. An owner can fix a typo in Settings.",
        action: { href: "/settings", label: "Open Settings", requires: "admin" },
      },
      {
        id: "roster",
        title: "Add your roster",
        text: "Players first. Coaches and staff can go on the roster too.",
        action: { href: "/team?add=person", label: "Add person", requires: "write", creates: true },
      },
      {
        id: "tournament",
        title: "Add your first tournament",
        text: "A name and a date is enough. You can add tournaments you're still considering, before you commit.",
        action: { href: "/tournaments?add=1", label: "Add tournament", requires: "write", creates: true },
      },
      {
        id: "dues",
        title: "Set what players owe",
        text: "Enter a team total to split, or an amount per player.",
        action: { href: "/finance?tab=player-payments", label: "Open Player Dues", requires: "write" },
      },
      {
        id: "access",
        title: "Give your coaches a login",
        text: "Being on the roster doesn't let anyone sign in. Owners invite coaches and managers.",
        action: { href: "/help/access", label: "How access works" },
      },
      {
        id: "previous-season",
        title: "Look back at a past season",
        text: "Use the season menu under your team name. Past seasons are kept as a record and don't take new entries.",
      },
      {
        id: "new-season",
        title: "Start next season",
        text: "Choose who carries over to the new season, and whether to copy the budget. Last season stays as it was. Switching to the new season is a separate step.",
        action: { href: "/settings?new-season=1", label: "Start next season", requires: "admin" },
      },
    ],
    goodToKnow: [
      "The setup checklist ticks itself off from what you've entered. There's nothing to mark done.",
      "Hid the checklist on Home? It's always at the top of Help & Getting Started.",
    ],
  },

  {
    slug: "roster",
    title: "Build your roster and add parents",
    summary: "Players, staff, and the parents you'll need to reach.",
    keywords: "roster player kid athlete parent guardian mom dad family contact phone email staff coach import spreadsheet inactive pickup jersey",
    who: "Available to team members with access to the roster.",
    pieces: ROSTER_VS_ACCESS,
    steps: [
      {
        id: "add-player",
        title: "Add a player",
        text: "A name is all you need. Jersey, positions and sizes can come later.",
        action: { href: "/team?add=person", label: "Add person", requires: "write", creates: true },
      },
      {
        id: "add-staff",
        title: "Put coaches and staff on the roster",
        text: "In Add person, set Type to Staff. They appear on the team list but can't sign in.",
        action: { href: "/team?add=person", label: "Add person", requires: "write", creates: true },
      },
      {
        id: "guardians",
        title: "Add parents and guardians",
        text: "Open a player, then Contacts, then Add contact. Choose a primary contact for the player.",
        action: { href: "/team", label: "Go to Team" },
      },
      {
        id: "import",
        title: "Import players from a spreadsheet",
        text: "Choose Import players on Team. You review the matches before anything is saved.",
        action: { href: "/team", label: "Go to Team" },
      },
      {
        id: "inactive",
        title: "When someone leaves the team",
        text: "Open them and choose Make inactive.",
      },
      {
        id: "pickups",
        title: "Add a pickup for one tournament",
        text: "Pickups go on that tournament's roster, not the season roster.",
        action: { href: "/help/tournaments#tournament-roster", label: "Tournament roster" },
      },
      {
        id: "login",
        title: "Give a coach a login",
        text: "That's an invitation from an organization owner, not a roster entry.",
        action: { href: "/help/access#invite", label: "How invitations work" },
      },
    ],
    goodToKnow: [
      "Making a player inactive doesn't remove their dues or payment history.",
      "Jersey numbers and positions belong to this season, so they can change next season.",
    ],
  },

  {
    slug: "tournaments",
    title: "Plan tournaments and add games",
    summary: "From an event you're considering to games and scores.",
    keywords: "tournament event weekend tourney game score result opponent schedule registration entry fee commit considering declined",
    who: "Available to team members with access to Tournaments.",
    steps: [
      {
        id: "add",
        title: "Add a tournament",
        text: "A name and a date is enough to start.",
        action: { href: "/tournaments?add=1", label: "Add tournament", requires: "write", creates: true },
      },
      {
        id: "decide",
        title: "Considering, Committed or Declined",
        text: "Considering and Declined don't affect your budget. A Committed tournament's cost counts against the budget line you choose for it.",
        action: { href: "/tournaments", label: "Go to Tournaments" },
      },
      {
        id: "registration",
        title: "Track registration and payment",
        text: "Kept separate from the decision. It's normal to commit before you've registered.",
      },
      {
        id: "costs",
        title: "Add costs and a budget line",
        text: "In the tournament's Costs, enter the entry and gate fees and choose the budget line they count against.",
      },
      {
        id: "locations",
        title: "Link the field, hotel and places to eat",
        text: "Use the tournament's Locations & Resources section.",
        action: { href: "/help/locations#link", label: "Linking places" },
      },
      {
        id: "tournament-roster",
        title: "Set the tournament roster",
        text: "Who's going, including pickups. Empty just means it isn't set yet.",
      },
      {
        id: "games",
        title: "Add games and scores",
        text: "Games live inside the tournament. Choose + Add game as the schedule comes out, and enter scores after.",
      },
    ],
    goodToKnow: [
      "Committed with no budget line? Finance lists its cost as not assigned to a budget category, outside Available, until you choose one.",
      "Open a tournament from the list to see all of its sections.",
      "Tracking Quality At-Bats? The same games are used there.",
    ],
    related: [{ href: "/help/qab", label: "Track Quality At-Bats" }],
  },

  {
    slug: "qab",
    title: "Track Quality At-Bats",
    summary: "From the tournament roster to a corrected game and the report.",
    keywords: "qab quality at-bat at bat lineup batting order track tracking plate appearance performance stats scorebook fix correct",
    who: "Available to team members with access to Performance.",
    feature: "qab",
    steps: [
      {
        id: "tournament-roster",
        title: "Set the tournament roster",
        text: "Open the tournament and set who's playing, including pickups. If it isn't set, the season roster is used.",
        action: { href: "/tournaments", label: "Go to Tournaments" },
      },
      {
        id: "batting-order",
        title: "Set the batting order",
        text: "On Performance, choose the game and Set batting order. Copy lineup from… reuses another game's order.",
        action: { href: "/performance", label: "Open Performance", requires: "qab" },
      },
      {
        id: "track",
        title: "Track live, or after the game",
        text: "Record each plate appearance as it happens. You can enter QABs after a game if you didn't track them live.",
      },
      {
        id: "record",
        title: "Record each plate appearance",
        text: "For a QAB, choose the one reason that fits best, then Record QAB. Otherwise tap No QAB. + Add note keeps optional context with it.",
      },
      {
        id: "finish",
        title: "Finish tracking",
        text: "Enter the final score if the game is over, or finish without one and add it later on Performance.",
      },
      {
        id: "correct",
        title: "Fix a completed game",
        text: "Choose Review & Edit, then Edit at-bats. Change a reason, mark No QAB, or remove an at-bat. Wrong batter? Remove it and record it again.",
        action: { href: "/performance", label: "Open Performance", requires: "qab" },
      },
      {
        id: "reports",
        title: "See and print the results",
        text: "Reports, then QAB Performance, by season or by tournament.",
        action: { href: "/reports/qab-performance", label: "Open QAB report", requires: "qab" },
      },
    ],
    goodToKnow: [
      "Finishing doesn't lock a game. You can correct it any time.",
      "In Tournaments, the same game shows Set lineup, Continue QABs or Review & Edit QABs.",
      "In a past season, corrections are limited to organization owners.",
    ],
  },

  {
    slug: "money",
    title: "Manage team money",
    summary: "Plan the season, record what happens, and see who still owes.",
    keywords: "money finance budget expense receipt bill dues fees owe owed balance payment paid venmo cash check fundraising sponsor income",
    who: "Available to team members with access to Finance.",
    pieces: {
      title: "How the pieces fit",
      items: [
        { term: "Budget", text: "Your plan: what you expect to spend and raise this season." },
        { term: "Transactions", text: "What actually happened: each expense, and money in that isn't dues." },
        { term: "Money In", text: "Everything received so far: dues, fundraising and sponsors." },
        { term: "Player Dues", text: "What each player owes for the season." },
        { term: "Payments", text: "What a family has paid, recorded on that player's dues." },
      ],
    },
    steps: [
      {
        id: "budget",
        title: "Build your budget",
        text: "Add a line for each thing you expect to spend on or raise.",
        action: { href: "/finance?tab=budget", label: "Open Budget" },
      },
      {
        id: "expense",
        title: "Record an expense",
        text: "Add transaction, choose its budget line, then To Pay or Paid.",
        action: { href: "/finance?tab=transactions&add=1", label: "Add transaction", requires: "write", creates: true },
      },
      {
        id: "income",
        title: "Record fundraising or sponsorship",
        text: "Add transaction as income when you receive it. It counts toward Money In once you enter the amount.",
        action: { href: "/finance?tab=transactions&add=1", label: "Add transaction", requires: "write", creates: true },
      },
      {
        id: "dues",
        title: "Set player dues",
        text: "Enter a team total to split evenly, or an amount per player.",
        action: { href: "/finance?tab=player-payments", label: "Open Player Dues" },
      },
      {
        id: "payment",
        title: "Record a payment",
        text: "Open the player in Player Dues, then Record payment. Each payment is kept separately.",
      },
      {
        id: "owed",
        title: "See who still owes",
        text: "Filter Player Dues by Owes balance or Not started.",
      },
    ],
    goodToKnow: [
      "A committed tournament's cost counts against the budget line you choose for it.",
      "A budget line with transactions or tournaments on it can't be deleted until they're moved.",
      "Once a payment is recorded, a player's total due can't go below what's been paid.",
      "Setting dues for all players? Uncheck anyone who doesn't owe team dues. They're recorded as exempt.",
    ],
    related: [{ href: "/help/reports#budget", label: "Share the budget with parents" }],
  },

  {
    slug: "files",
    title: "Keep files together",
    summary: "Waivers, insurance and schedules, where you'll look for them.",
    keywords: "file document upload waiver insurance pdf photo paperwork form attach",
    who: "Available to team members with access to Files.",
    steps: [
      {
        id: "upload",
        title: "Upload a file",
        text: "PDFs, photos and documents: waivers, insurance, schedules.",
        action: { href: "/files?upload=1", label: "Upload file", requires: "write", creates: true },
      },
      {
        id: "attach",
        title: "Attach it to a player or tournament",
        text: "Choose who or what it belongs to, so it also shows up there.",
      },
      {
        id: "open",
        title: "Find and open a file",
        text: "Search by file name or category, then choose a file to open it.",
        action: { href: "/files", label: "Go to Files" },
      },
    ],
    goodToKnow: ["Files are only visible to people in your organization."],
  },

  {
    slug: "locations",
    title: "Save fields, hotels and places to eat",
    summary: "Know where you're playing and what to remember when you get there.",
    keywords: "location facility field park complex venue hotel lodging restaurant dining food parking directions notes",
    who: "Available to team members with access to Locations & Resources.",
    steps: [
      {
        id: "find",
        title: "Find a field",
        text: "All is the shared directory. Search it by name, city or county.",
        action: { href: "/facilities?view=all", label: "Browse all locations" },
      },
      {
        id: "saved",
        title: "Saved and All",
        text: "Saved shows places your organization added, wrote notes on, or linked to a tournament, and fields where one of your tournaments is held (unless you declined it).",
      },
      {
        id: "notes",
        title: "Add your team's notes",
        text: "Open a place and add parking, gate or concession notes.",
        action: { href: "/facilities", label: "Go to Locations & Resources" },
      },
      {
        id: "add",
        title: "Add a place that's missing",
        text: "Add location covers fields, hotels and restaurants. Places are shared, so check All first.",
        action: { href: "/facilities?add=1", label: "Add location", requires: "write" },
      },
      {
        id: "link",
        title: "Link places to a tournament",
        text: "In the tournament's Locations & Resources, mark each one Used, Recommended or Considered.",
      },
    ],
    goodToKnow: ["Your notes stay private to your organization. Other organizations never see them."],
  },

  {
    slug: "access",
    title: "Invite coaches and managers",
    summary: "Give someone a Season Tempo login for your team.",
    keywords: "invite invitation login sign in access account user permission email assistant coach manager",
    who: "Inviting people and changing access are organization owner tasks.",
    pieces: ROSTER_VS_ACCESS,
    steps: [
      {
        id: "invite",
        title: "Invite someone",
        text: "Settings, then People & Access, then Invite someone. Choose their role and team.",
        action: { href: "/settings?invite=1", label: "Invite someone", requires: "admin" },
      },
      {
        id: "deliver",
        title: "They get an email",
        text: "Season Tempo emails the invitation. You can also copy the link and send it yourself.",
      },
      {
        id: "accept",
        title: "They sign in with that address",
        text: "They must use the exact email you invited. An invitation lasts 14 days.",
      },
      {
        id: "manage",
        title: "Resend, renew or revoke",
        text: "Pending invitations are listed in People & Access, with what you can do next.",
        action: { href: "/settings", label: "Go to Settings", requires: "admin" },
      },
    ],
    goodToKnow: [
      "What someone can see and change after they sign in depends on the access they're given.",
      "Not an owner? Ask your organization owner to send the invitation.",
    ],
  },

  {
    slug: "reports",
    title: "Print and share reports",
    summary: "Clean documents for parents and coaches, from your season data.",
    keywords: "report print pdf share parents handout schedule budget qab",
    who: "Available to team members with access to Reports.",
    steps: [
      {
        id: "budget",
        title: "Planned Season Budget, for parents",
        text: "What the season is expected to cost.",
        action: { href: "/reports/season-budget", label: "Open budget report" },
      },
      {
        id: "schedule",
        title: "Tournament Schedule, for parents",
        text: "Choose Tournaments only, or Include game schedule.",
        action: { href: "/reports/tournament-schedule", label: "Open schedule" },
      },
      {
        id: "qab",
        title: "QAB Performance, for coaches",
        text: "By season or by tournament.",
        action: { href: "/reports/qab-performance", label: "Open QAB report", requires: "qab" },
      },
      {
        id: "print",
        title: "Print or save a PDF",
        text: "Use Print / Save as PDF at the top of any report.",
      },
    ],
    goodToKnow: ["Reports show the season you're viewing. Switch seasons with the season menu."],
    related: [{ href: "/reports", label: "All reports" }],
  },
];

export const findGuide = (slug) => HELP_GUIDES.find((g) => g.slug === slug) ?? null;
