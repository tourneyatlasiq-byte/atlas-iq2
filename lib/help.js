import { safeNext } from "./auth-redirect";
import { HELP_GUIDES, findGuide } from "./help-guides";
import { askHelp } from "./help-search";

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
        // Roster only. Before 2026-11 this read "Add a coach or manager", and
        // coaches added an assistant here expecting her to be able to sign in.
        id: "add-coach",
        title: "Put a coach or staff on the roster",
        text: "Adds them to the team list. It doesn't give them a login.",
        href: "/team?add=person",
        cta: "Add person",
        direct: true,
        keywords: "staff assistant helper adult volunteer coach manager roster",
      },
      {
        id: "add-guardian",
        title: "Add a parent or guardian",
        text: "Open a player, then Contacts, then Add contact.",
        href: "/team",
        cta: "Go to Team",
        direct: false,
        keywords: "parent guardian mom dad mother father contact phone email family primary",
      },
      {
        id: "update-player",
        title: "Update player information",
        text: "Jersey, sizes, contacts and positions.",
        href: "/team",
        cta: "Go to Team",
        direct: false,
        keywords: "edit change jersey size uniform phone email position",
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
        title: "Add a game or score",
        text: "Games live inside each tournament — open one first.",
        href: "/tournaments",
        cta: "Go to Tournaments",
        direct: false,
        keywords: "game score result won lost win loss record opponent bracket pool",
      },
      {
        id: "update-registration",
        title: "Update registration or payment",
        text: "Mark an event registered, waitlisted or paid.",
        href: "/tournaments",
        cta: "Go to Tournaments",
        direct: false,
        keywords: "registered waitlist paid deposit entry fee status",
      },
      {
        id: "commit-tournament",
        title: "Commit to a tournament",
        text: "Move it from Considering to Committed.",
        href: "/tournaments",
        cta: "Go to Tournaments",
        direct: false,
        keywords: "commit going decide considering declined confirm",
      },
    ],
  },
  {
    id: "qab",
    label: "Quality At-Bats",
    tasks: [
      {
        id: "qab-start",
        title: "Track QABs for a game",
        text: "Tournament roster, batting order, then track live or after the game.",
        href: "/help/qab",
        cta: "QAB guide",
        direct: false,
        keywords: "qab quality at-bat at bat track tracking lineup batting order performance plate appearance",
      },
      {
        id: "qab-correct",
        title: "Fix a completed game",
        text: "Review & Edit, then Edit at-bats. Finishing doesn't lock a game.",
        href: "/help/qab#correct",
        cta: "How to correct",
        direct: false,
        keywords: "qab fix correct mistake wrong edit undo remove completed finished game",
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
        cta: "Open Player Dues",
        direct: true,
        keywords: "dues fees owe cost per player season charge",
      },
      {
        id: "record-payment",
        title: "Record a player payment",
        text: "Open the player in Player Dues, then Record payment.",
        href: "/finance?tab=player-payments",
        cta: "Open Player Dues",
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
        cta: "Open Player Dues",
        direct: true,
        keywords: "outstanding balance owed unpaid behind chase",
      },
    ],
  },
  {
    id: "places",
    label: "Locations & Resources",
    tasks: [
      {
        id: "find-facility",
        title: "Find a field or facility",
        text: "Search by name, city or county.",
        href: "/facilities?view=all",
        cta: "Browse all locations",
        direct: true,
        keywords: "facility venue field park complex where playing directions address",
      },
      {
        id: "facility-notes",
        title: "Save notes about a place",
        text: "Open it, then add parking and gate notes.",
        href: "/facilities",
        cta: "Go to Locations & Resources",
        direct: false,
        keywords: "parking gate concessions restroom shade notes remember",
      },
      {
        id: "add-facility",
        title: "Add a field, hotel or restaurant",
        text: "The place isn't in Season Tempo yet.",
        href: "/facilities?add=1",
        cta: "Add location",
        direct: true,
        keywords: "new facility venue missing not listed create park hotel lodging dining restaurant food",
      },
    ],
  },
  {
    id: "files",
    label: "Files & Reports",
    tasks: [
      {
        id: "upload-document",
        title: "Upload a document",
        text: "Attach it to a player or tournament.",
        href: "/files?upload=1",
        cta: "Upload file",
        direct: true,
        keywords: "waiver insurance schedule roster form pdf photo paperwork document",
      },
      {
        id: "print-report",
        title: "Print a report for parents",
        text: "Season budget or tournament schedule, as a PDF.",
        href: "/reports",
        cta: "Open Reports",
        direct: true,
        keywords: "print pdf report share parents schedule budget handout",
      },
    ],
  },
  {
    id: "seasons",
    label: "Seasons & Access",
    tasks: [
      {
        // Owner-only tasks route through their guide rather than opening the
        // form: the guide says who can do it and offers the action only to an
        // owner (2026-11).
        id: "new-season",
        title: "Start a new season",
        text: "Owners carry the roster into next year from Settings.",
        href: "/help/setup#new-season",
        cta: "How to start a season",
        direct: false,
        keywords: "next year rollover 2027 new season roll over",
      },
      {
        id: "view-season",
        title: "View a previous season",
        text: "Use the season menu under your team name.",
        href: null,
        cta: null,
        direct: false,
        keywords: "last year history past previous old season switch",
      },
      {
        id: "invite",
        title: "Give someone a login",
        text: "Owners invite coaches and managers. Being on the roster isn't a login.",
        href: "/help/access#invite",
        cta: "How invitations work",
        direct: false,
        keywords: "invite add user access permission share account login sign in password",
      },
      {
        id: "rename",
        title: "Rename your team or season",
        text: "Owners can fix a name in Settings.",
        href: "/help/setup#names",
        cta: "How to rename",
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
  "/team": ["add-player", "add-guardian", "add-coach"],
  "/facilities": ["find-facility", "facility-notes", "add-facility"],
  "/finance": ["set-dues", "record-payment", "add-expense"],
  "/files": ["upload-document"],
  "/performance": ["qab-start", "qab-correct"],
  "/reports": ["print-report"],
  "/settings": ["invite", "new-season", "rename"],
};

export function tasksForPath(pathname) {
  const key = Object.keys(ON_THIS_PAGE).find((p) => pathname.startsWith(p));
  return key ? ON_THIS_PAGE[key].map(findTask).filter(Boolean) : [];
}

/**
 * The one matching rule for all Help search: every word typed must appear
 * somewhere in the item's words. Used by the Help popover (tasks) and by
 * Help & Getting Started (guides, steps and tasks).
 */
export function searchTerms(query) {
  const q = String(query ?? "").trim().toLowerCase();
  return q ? q.split(/\s+/) : null;
}
export function matchesTerms(terms, ...fields) {
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Matches title, sentence and the words a coach would actually type. */
export function searchTasks(query) {
  const terms = searchTerms(query);
  if (!terms) return null;

  return HELP_GROUPS.map((g) => ({
    ...g,
    tasks: g.tasks.filter((t) => matchesTerms(terms, t.title, t.text, t.keywords)),
  })).filter((g) => g.tasks.length > 0);
}

/* ---------------- Help & Getting Started (V1, 2026-11) ---------------- */

/**
 * Which guide belongs to the page you're on. Game screens (lineup, tracking)
 * live under /tournaments but are QAB work, so they are matched first.
 * Contacts has no guide in V1.
 */
const PAGE_GUIDE = [
  [/^\/tournaments\/[^/]+\/games\//, "qab"],
  [/^\/performance(\/|$)/, "qab"],
  [/^\/dashboard(\/|$)/, "setup"],
  [/^\/team(\/|$)/, "roster"],
  [/^\/tournaments(\/|$)/, "tournaments"],
  [/^\/finance(\/|$)/, "money"],
  [/^\/files(\/|$)/, "files"],
  [/^\/facilities(\/|$)/, "locations"],
  [/^\/settings(\/|$)/, "access"],
  [/^\/reports(\/|$)/, "reports"],
];

export function guideForPath(pathname) {
  const hit = PAGE_GUIDE.find(([re]) => re.test(pathname ?? ""));
  return hit ? findGuide(hit[1]) : null;
}

/** Labels for "Back to …", in the navigation's own words. */
const BACK_LABELS = [
  [/^\/tournaments\/[^/]+\/games\/[^/]+\/lineup/, "batting order"],
  [/^\/tournaments\/[^/]+\/games\/[^/]+\/track/, "QAB tracking"],
  [/^\/dashboard/, "Home"],
  [/^\/tournaments/, "Tournaments"],
  [/^\/team/, "Team"],
  [/^\/facilities/, "Locations & Resources"],
  [/^\/finance/, "Finance"],
  [/^\/performance/, "Performance"],
  [/^\/reports/, "Reports"],
  [/^\/files/, "Files"],
  [/^\/contacts/, "Contacts"],
  [/^\/settings/, "Settings"],
];

/**
 * Where "Back" goes. `from` is the exact path and query the person left —
 * ?open=<id>, ?tab= and the rest — so returning reopens the same drawer and
 * tab. It passes through safeNext, so only a same-site path survives, and a
 * path back into Help itself is ignored rather than looping.
 */
export function helpReturn(from) {
  const path = safeNext(from, null);
  if (!path || /^\/help(\/|\?|#|$)/.test(path)) return null;
  const hit = BACK_LABELS.find(([re]) => re.test(path));
  return { href: path, label: hit ? hit[1] : "where you were" };
}

/** A link into Help that remembers where it came from. */
export function helpHref(target = "/help", from = null) {
  const [base, hash] = String(target).split("#");
  const back = helpReturn(from);
  const qs = back ? `${base.includes("?") ? "&" : "?"}from=${encodeURIComponent(back.href)}` : "";
  return `${base}${qs}${hash ? `#${hash}` : ""}`;
}

export const isHelpLink = (href) => typeof href === "string" && /^\/help(\/|\?|#|$)/.test(href);

/**
 * Can this person use a guide action? Help never offers what the person
 * can't complete — it says why. Server authorization is unchanged and still
 * decides; this only keeps Help from leading anyone into a refusal.
 *
 * access: { isAdmin, canWrite, qab, phase }
 */
/**
 * Why an action isn't offered. Worded around access rather than role names,
 * so it stays true when owners can grant individual access (Phase 5).
 */
export const ACCESS_REASON = {
  admin: "Your access doesn't include this. An organization owner can do it.",
  write: "Your access lets you view this, not change it.",
};

export function actionState(action, access = {}) {
  if (!action) return { ok: false, reason: null };
  if (action.requires === "admin" && !access.isAdmin) {
    return { ok: false, reason: ACCESS_REASON.admin };
  }
  if (action.requires === "write" && !access.canWrite) {
    return { ok: false, reason: ACCESS_REASON.write };
  }
  if (action.requires === "qab" && !access.qab) {
    return { ok: false, reason: "Performance isn't turned on for your organization." };
  }
  if (action.creates && access.phase === "past") {
    return { ok: false, reason: "You're viewing a past season. Switch to the current season to add this." };
  }
  return { ok: true, reason: null };
}

/**
 * Help search (2026-11): question-first, deterministic. The engine lives in
 * lib/help-search.js (answers first, then guide steps and guides, with
 * synonyms, negation, plurals and typo tolerance). Every Help surface — the
 * popover, /help and guide pages — calls this one function.
 */
export const searchHelp = (query, limit = 6) => askHelp(query, { limit });

export { HELP_GUIDES, findGuide };

export { askHelp };
