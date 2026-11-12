/**
 * Help answers (2026-11): the question-first layer of Help.
 *
 * Each answer is what a coach asks, answered in one or two sentences, with
 * the action that does it and the guide step that explains more:
 *
 *   Question -> direct answer -> open the screen -> full guide if needed
 *
 *   id        stable; /help?a=<id> shows this answer
 *   title     the task, in the coach's words
 *   answer    one or two sentences. Copy follows the approved guide wording
 *             and the same verified product behaviour.
 *   action    optional { href, label, requires, creates }, permission-aware
 *             through actionState (lib/help.js), exactly like guide actions
 *   guide     "slug#step" — the deeper layer
 *   keywords  everyday words and phrases a coach types. Search only.
 *   in        optional presentation variants, by screen, for contextual Help
 *             (H3): the same answer worded for someone already on that
 *             screen, so it never says "open" the screen they're using. The
 *             canonical `answer` stays authoritative everywhere else; a
 *             variant may only restate it, never add a different rule.
 *
 * Pure data (only the support address is imported) so the server page, the Help popover, guide-page
 * search and the check scripts all read the same answers. A future
 * conversational/AI layer can read the same entries as its grounding.
 */

import { SUPPORT_EMAIL } from "./legal";

export const HELP_ANSWERS = [
  /* ---------- Quality At-Bats ---------- */
  {
    id: "qab-track",
    title: "Track QABs for a game",
    answer: "Open Performance, choose the game and set the batting order. Then record each plate appearance: choose the one reason that made it a QAB, or tap No QAB.",
    action: { href: "/performance", label: "Open Performance", requires: "qab" },
    guide: "qab#batting-order",
    keywords: "track tracking record qab qabs quality at bat at-bat start live score keep stats plate appearance",
    in: {
      "lineup": "Once it's saved, start tracking: record each plate appearance in this order, choosing the one reason that made it a QAB, or No QAB.",
    },
  },
  {
    id: "qab-after-game",
    title: "Enter QABs after the game",
    answer: "You can enter QABs after a game if you didn't track them live. Open Performance, choose the game and record each plate appearance from your scorebook.",
    action: { href: "/performance", label: "Open Performance", requires: "qab" },
    guide: "qab#track",
    keywords: "after later afterwards post game scorebook missed forgot didn't track not live enter catch up past game yesterday",
    in: {
      "tracker-live": "Yes. If you don't track QABs live, you can return to this game later and enter each plate appearance from your scorebook.",
    },
  },
  {
    id: "qab-fix",
    title: "Fix a completed plate appearance",
    answer: "Open Performance, choose the tournament and Review & Edit for the completed game, then Edit the plate appearance you need to correct. Wrong batter? Remove it and record it again for the right player.",
    action: { href: "/performance", label: "Open Performance", requires: "qab" },
    guide: "qab#correct",
    keywords: "wrong batter hitter fix correct correction mistake edit change undo remove completed finished game wrong reason oops",
    in: {
      "tracker-live": "Switch to Edit at-bats, choose Remove on the plate appearance under the wrong batter, then use + Add plate appearance under the right batter and record it again.",
      "tracker-review": "Find the plate appearance under the wrong batter and choose Remove. Then use + Add plate appearance under the right batter and record it again.",
    },
  },
  {
    id: "qab-what-counts",
    title: "What counts as a QAB?",
    answer: "A plate appearance is a QAB when one of eight reasons applies: hit, walk, HBP, hard hit ball, 8+ pitches, situational success, sac bunt or sac fly. Choose the one that best represents it; otherwise tap No QAB.",
    action: { href: "/performance", label: "Open Performance", requires: "qab" },
    guide: "qab#record",
    keywords: "what counts qab quality at bat definition reason reasons count qualifies rule criteria",
  },
  {
    id: "qab-reason-change",
    title: "Change a QAB reason",
    answer: "In Review & Edit, choose Edit on the plate appearance, pick the right reason or No QAB, then Save correction. A note on it stays as it was.",
    action: { href: "/performance", label: "Open Performance", requires: "qab" },
    guide: "qab#correct",
    keywords: "change reason edit reason wrong reason switch qab no qab correction",
    in: {
      "tracker-review": "Choose Edit on the plate appearance, pick the right reason or No QAB, then Save correction. A note on it stays as it was.",
    },
  },
  {
    id: "qab-note",
    title: "Add a note to a plate appearance",
    answer: "While recording, tap + Add note to keep optional context with that plate appearance. You can view or edit it later in Review & Edit. Notes are context only; they don't change QAB counts or percentages.",
    action: { href: "/performance", label: "Open Performance", requires: "qab" },
    guide: "qab#record",
    keywords: "note notes add note comment comments context memo remark at bat plate appearance qab detail write",
    in: {
      "tracker-live": "Yes. Before you record, tap + Add note under the reasons. You can view or edit it later in Edit at-bats. Notes are context only; they don't change QAB counts or percentages.",
      "tracker-review": "Yes. Choose Edit on the plate appearance to change or clear its note, then Save correction. Notes don't change QAB counts or percentages.",
    },
  },
  {
    id: "qab-lineup",
    title: "Set a batting order",
    answer: "On Performance, choose the game and Set batting order. Copy lineup from… reuses another game's order. Players come from the tournament roster.",
    action: { href: "/performance", label: "Open Performance", requires: "qab" },
    guide: "qab#batting-order",
    keywords: "lineup line up batting order order card copy lineup who bats",
    in: {
      "lineup": "Put your batters in order here and save. Copy lineup from… reuses another game's order. Players come from the tournament roster.",
    },
  },
  {
    id: "qab-report",
    title: "See or print QAB results",
    answer: "Open Reports, then QAB Performance. Choose a season or a single tournament, then Print / Save as PDF.",
    action: { href: "/reports/qab-performance", label: "Open QAB report", requires: "qab" },
    guide: "qab#reports",
    keywords: "qab report results stats percentage print pdf season tournament performance numbers",
  },

  {
    id: "performance-premium",
    title: "Learn about Performance and QAB tracking",
    answer: "Performance, including QAB tracking, is a Premium feature that isn't turned on for your organization. Email support to ask about it.",
    action: { href: `mailto:${SUPPORT_EMAIL}`, label: "Email support" },
    guide: "qab",
    keywords: "performance premium qab enable turn on upgrade locked unavailable",
  },

  /* ---------- Money ---------- */
  {
    id: "dues-how",
    title: "How Player Dues work",
    answer: "Player Dues is what each player owes for the season. Set a team total to split evenly, or an amount per player, then record payments as families pay.",
    action: { href: "/finance?tab=player-payments", label: "Open Player Dues" },
    guide: "money#dues",
    keywords: "dues fees owe season cost per player charge team total split how work",
  },
  {
    id: "dues-payment",
    title: "Record a payment",
    answer: "Open the player in Player Dues, then Record payment. Each payment is kept separately, so partial payments add up.",
    action: { href: "/finance?tab=player-payments", label: "Open Player Dues" },
    guide: "money#payment",
    keywords: "pay paid payment payments venmo zelle cash check received parent family installment partial deposit",
    in: {
      "dues": "Open the player in the list below, then Record payment. Each payment is kept separately, so partial payments add up.",
    },
  },
  {
    id: "dues-exempt",
    title: "A player doesn't owe dues",
    answer: "When you set dues for all players, uncheck anyone who doesn't owe team dues. They're recorded as exempt instead of owing a balance.",
    action: { href: "/finance?tab=player-payments", label: "Open Player Dues" },
    guide: "money#dues",
    keywords: "not owe no dues exempt exemption waive waived free scholarship excluded skip coach's kid daughter doesn't pay",
  },
  {
    id: "dues-owed",
    title: "See who still owes",
    answer: "Filter Player Dues by Owes balance or Not started.",
    action: { href: "/finance?tab=player-payments", label: "Open Player Dues" },
    guide: "money#owed",
    keywords: "who owes still owe outstanding balance unpaid behind chase reminder late hasnt paid",
  },
  {
    id: "budget-vs-transactions",
    title: "Budget vs. Transactions",
    answer: "Budget is your plan: what you expect to spend and raise. Transactions are what actually happened: each expense, and money in that isn't dues.",
    action: { href: "/finance?tab=budget", label: "Open Budget" },
    guide: "money#budget",
    keywords: "difference budget transactions plan actual spending vs versus compare money in",
  },
  {
    id: "expense",
    title: "Record an expense",
    answer: "Add transaction, choose its budget line, then To Pay or Paid.",
    action: { href: "/finance?tab=transactions&add=1", label: "Add transaction", requires: "write", creates: true },
    guide: "money#expense",
    keywords: "expense receipt bill bought purchase spent spend cost invoice reimburse",
  },
  {
    id: "income",
    title: "Record fundraising or a sponsor",
    answer: "Add transaction as income when you receive it. It counts toward Money In once you enter the amount.",
    action: { href: "/finance?tab=transactions&add=1", label: "Add transaction", requires: "write", creates: true },
    guide: "money#income",
    keywords: "fundraiser fundraising sponsor sponsorship donation income raised money in",
  },
  {
    id: "budget-line-delete",
    title: "Can't delete a budget line",
    answer: "A budget line with transactions or tournaments on it can't be deleted until they're moved to another line.",
    action: { href: "/finance?tab=budget", label: "Open Budget" },
    guide: "money",
    keywords: "delete remove budget line category won't blocked not allowed",
  },

  /* ---------- Tournaments and games ---------- */
  {
    id: "tournament-add",
    title: "Add a tournament",
    answer: "A name and a date is enough to start. You can add tournaments you're still considering, before you commit.",
    action: { href: "/tournaments?add=1", label: "Add tournament", requires: "write", creates: true },
    guide: "tournaments#add",
    keywords: "add new tournament event tourney weekend schedule considering",
  },
  {
    id: "games-add",
    title: "Add games",
    answer: "Games live inside a tournament. Open the tournament and choose + Add game as the schedule comes out, then enter scores after.",
    action: { href: "/tournaments", label: "Go to Tournaments" },
    guide: "tournaments#games",
    keywords: "game games add schedule opponent score result bracket pool won lost",
  },
  {
    id: "tournament-costs",
    title: "How tournament costs work",
    answer: "Enter entry and gate fees in the tournament's Costs and choose the budget line they count against. Considering and Declined tournaments don't affect your budget.",
    action: { href: "/tournaments", label: "Go to Tournaments" },
    guide: "tournaments#costs",
    keywords: "cost costs fee fees entry gate budget price committed money tournament",
  },
  {
    id: "tournament-places",
    title: "Add a hotel or field to a tournament",
    answer: "In the tournament's Locations & Resources, mark each place Used, Recommended or Considered. If a place is missing, add it in Locations & Resources first.",
    action: { href: "/facilities?add=1", label: "Add location", requires: "write" },
    guide: "locations#link",
    keywords: "hotel lodging motel stay field facility venue park complex restaurant dining food eat place link tournament",
  },
  {
    id: "tournament-roster",
    title: "Set who's going to a tournament",
    answer: "Open the tournament and set its tournament roster. Pickup players are added there, for that tournament only.",
    action: { href: "/tournaments", label: "Go to Tournaments" },
    guide: "tournaments#tournament-roster",
    keywords: "tournament roster attending going pickup pick up guest player borrowed",
  },
  {
    id: "tournament-decision",
    title: "Commit to a tournament",
    answer: "Open the tournament and set its decision to Committed. Registration and payment are tracked separately.",
    action: { href: "/tournaments", label: "Go to Tournaments" },
    guide: "tournaments#decide",
    keywords: "commit committed decide decision considering declined going registration registered waitlist",
  },

  /* ---------- Team and access ---------- */
  {
    id: "player-add",
    title: "Add a player",
    answer: "On Team, choose Add person. A name is all you need; jersey, positions and sizes can come later.",
    action: { href: "/team?add=person", label: "Add person", requires: "write", creates: true },
    guide: "roster#add-player",
    keywords: "add player kid athlete girl new join roster member",
  },
  {
    id: "parent-add",
    title: "Add a parent or guardian",
    answer: "Open the player, then Contacts, then Add contact. Choose a primary contact for the player.",
    action: { href: "/team", label: "Go to Team" },
    guide: "roster#guardians",
    keywords: "parent guardian mom dad mother father family contact phone email primary",
  },
  {
    id: "coach-login",
    title: "A coach can't sign in",
    answer: "Being on the roster doesn't give anyone a login. An organization owner invites them from Settings, then People & Access, choosing their role and team. They must sign in with the exact email that was invited.",
    action: { href: "/settings?invite=1", label: "Invite someone", requires: "admin" },
    guide: "access#invite",
    keywords: "login log in sign in signin access account password invite invitation coach assistant manager staff email can't cannot get in",
    in: {
      "people": "Being on the roster doesn't give anyone a login. An organization owner invites them here with Invite someone, choosing their role and team. They must sign in with the exact email that was invited.",
    },
  },
  {
    id: "player-left",
    title: "A player left the team",
    answer: "Open them on Team and choose Make inactive. Their dues and payment history stay.",
    action: { href: "/team", label: "Go to Team" },
    guide: "roster#inactive",
    keywords: "left quit leave inactive remove player gone departed",
  },
  {
    id: "players-import",
    title: "Import players from a spreadsheet",
    answer: "Choose Import players on Team. You review the matches before anything is saved.",
    action: { href: "/team", label: "Go to Team" },
    guide: "roster#import",
    keywords: "import spreadsheet excel csv upload list bulk",
  },

  /* ---------- Season, files, places, reports ---------- */
  {
    id: "season-next",
    title: "Start next season",
    answer: "An organization owner chooses who carries over to the new season, and whether to copy the budget. Last season stays as it was.",
    action: { href: "/settings?new-season=1", label: "Start next season", requires: "admin" },
    guide: "setup#new-season",
    keywords: "new season next year rollover roll over 2027 start",
  },
  {
    id: "season-previous",
    title: "Look back at a past season",
    answer: "Use the season menu under your team name. Past seasons are kept as a record and don't take new entries.",
    guide: "setup#previous-season",
    keywords: "last year previous past old season history switch",
  },
  {
    id: "file-upload",
    title: "Upload a file",
    answer: "Upload it in Files and attach it to a player or tournament so it shows up there too.",
    action: { href: "/files?upload=1", label: "Upload file", requires: "write", creates: true },
    guide: "files#upload",
    keywords: "upload file document waiver insurance pdf photo paperwork form attach",
  },
  {
    id: "place-notes",
    title: "Save notes about a field",
    answer: "Open the place in Locations & Resources and add parking, gate or concession notes. Notes stay private to your organization.",
    action: { href: "/facilities", label: "Go to Locations & Resources" },
    guide: "locations#notes",
    keywords: "notes parking gate concessions restroom field facility remember tips",
  },
  {
    id: "report-parents",
    title: "Print a schedule or budget for parents",
    answer: "Open Reports and choose Planned Season Budget or Tournament Schedule, then Print / Save as PDF.",
    action: { href: "/reports", label: "Open Reports" },
    guide: "reports#print",
    keywords: "print pdf share parents handout schedule budget report email families",
  },
];

/** Shown on /help before anything is typed. */
export const POPULAR_ANSWERS = ["qab-track", "player-add", "dues-payment", "tournament-add"];
/** Used in place of QAB items when Performance isn't turned on. */
export const POPULAR_FALLBACK = ["dues-how", "games-add"];

/**
 * What the Help popover asks first, by screen. Game screens (lineup, tracking)
 * are matched before Tournaments.
 */
export const PAGE_QUESTIONS = [
  // [screen, questions with QAB on, questions with QAB off]
  [/^\/tournaments\/[^/]+\/games\//, ["qab-track", "qab-after-game", "qab-fix"], ["games-add", "tournament-roster", "tournament-costs"]],
  [/^\/performance(\/|$)/, ["qab-track", "qab-after-game", "qab-fix"], ["performance-premium", "games-add", "tournament-roster"]],
  [/^\/finance(\/|$)/, ["dues-how", "dues-payment", "budget-vs-transactions"]],
  [/^\/tournaments(\/|$)/, ["games-add", "tournament-costs", "tournament-places"]],
  [/^\/team(\/|$)/, ["player-add", "parent-add", "coach-login"]],
  [/^\/settings(\/|$)/, ["coach-login", "season-next", "season-previous"]],
  [/^\/facilities(\/|$)/, ["tournament-places", "place-notes"]],
  [/^\/files(\/|$)/, ["file-upload"]],
  [/^\/reports(\/|$)/, ["report-parents", "qab-report"], ["report-parents", "season-previous"]],
  [/^\/dashboard(\/|$)/, ["player-add", "tournament-add", "dues-how"]],
];

export const findAnswer = (id) => HELP_ANSWERS.find((a) => a.id === id) ?? null;

const isQab = (a) => a?.action?.requires === "qab";

/**
 * Questions for this screen, at most three. Without QAB, a screen's QAB
 * questions are replaced by its non-QAB list — never shown.
 */
export function questionsForPath(pathname, { qab = true } = {}) {
  const hit = PAGE_QUESTIONS.find(([re]) => re.test(pathname ?? ""));
  const ids = hit ? (!qab && hit[2] ? hit[2] : hit[1]) : POPULAR_ANSWERS;
  return ids.map(findAnswer).filter((a) => a && (qab || !isQab(a))).slice(0, 3);
}

/** Popular answers for /help, swapping QAB items out when Performance is off. */
export function popularAnswers({ qab = true } = {}) {
  const base = POPULAR_ANSWERS.map(findAnswer).filter(Boolean);
  if (qab) return base;
  const kept = base.filter((a) => !isQab(a));
  const extra = POPULAR_FALLBACK.map(findAnswer).filter((a) => a && !kept.includes(a));
  return [...kept, ...extra].slice(0, base.length);
}
