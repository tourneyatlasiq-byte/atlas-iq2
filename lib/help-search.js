/**
 * Help search (2026-11): deterministic, question-first.
 *
 * Searches the direct answers first, then guide steps, guides and popover
 * shortcuts, all from the same structured content. No AI and no external
 * service. Everyday coach language is handled by:
 *
 *   - stop words ("how do I", "the", "my")         dropped
 *   - negation ("doesn't", "can't", "no")          one token: "not"
 *   - synonyms ("mom" = parent, "venmo" = pay)     one canonical token
 *   - plurals ("players")                           singular
 *   - typos ("battr", "tournment", "exmpt")          edit distance 1–2
 *   - prefixes ("tourn", "invit")                   matched to full words
 *
 * askHelp(query, ctx) is the one entry point the UI calls, and it returns
 * plain result objects ({ kind, id, title, text, href, action, guide }). A
 * future conversational or AI layer can replace or wrap askHelp and return
 * the same shape, so the UI does not need another redesign.
 */
import { HELP_ANSWERS, findAnswer } from "./help-answers";
import { HELP_GUIDES } from "./help-guides";

const STOP = new Set(`a an the i me my we our us you your to of for in on at by with and or is are am be
  been it its this that these those there here how what where when why which who whom do does did done
  can could should would will please help want need way get got go going some any just about into
  from up out if so than then too very im ive id as`.split(/\s+/).filter(Boolean));

const NEGATION = new Set(["not", "no", "dont", "doesnt", "didnt", "cant", "cannot", "isnt", "wont", "arent", "never", "without", "wasnt", "hasnt", "havent", "hadnt", "werent", "shouldnt"]);

/** Everyday words -> one canonical token. Multi-word phrases first. */
const PHRASES = [
  [/\bat[\s-]?bats?\b/g, "qab"],
  [/\bquality at[\s-]?bats?\b/g, "qab"],
  [/\bplate appearances?\b/g, "pa"],
  [/\bbatting order\b/g, "lineup"],
  [/\bline[\s-]?ups?\b/g, "lineup"],
  [/\blog[\s-]?(in|on)\b/g, "login"],
  [/\bsign[\s-]?(in|on)\b/g, "login"],
  [/\bpick[\s-]?ups?\b/g, "pickup"],
  [/\bmoney in\b/g, "income"],
  [/\bscore ?book\b/g, "scorebook"],
  // Two everyday meanings of "not paying" that point at different answers.
  [/\b(hasnt|havent|hadnt|not|never) (yet )?(paid|payed)\b/g, "unpaid"],
  [/\bstill (owe|owes|owing)\b/g, "unpaid"],
  [/\b(doesnt|dont|does not|do not|wont|not|no longer) (have to )?(owe|pay)( dues)?\b/g, "exempt"],
  [/\bno dues\b/g, "exempt"],
];
const SYNONYMS = {
  qab: ["qab", "qabs", "quality"],
  pa: ["pa", "pas", "atbat", "atbats"],
  player: ["player", "kid", "athlete", "girl", "daughter", "child", "son", "member"],
  parent: ["parent", "guardian", "mom", "mum", "dad", "mother", "father", "family", "families"],
  dues: ["dues", "due", "owe", "owes", "owed", "owing", "balance", "charge"],
  pay: ["pay", "paid", "payment", "paying", "venmo", "zelle", "cash", "cheque", "deposit", "installment"],
  add: ["add", "put", "create", "insert"],
  tournament: ["tournament", "tourney", "event", "weekend", "tourn", "tournment", "tournamnet"],
  game: ["game", "match", "matchup"],
  fix: ["fix", "correct", "correction", "edit", "change", "wrong", "mistake", "undo", "update", "adjust", "oops", "error"],
  batter: ["batter", "hitter"],
  after: ["after", "later", "afterwards", "afterward", "post", "missed", "forgot", "yesterday"],
  lineup: ["lineup", "order"],
  login: ["login", "signin", "logon", "access", "account", "password"],
  invite: ["invite", "invitation", "invited"],
  hotel: ["hotel", "lodging", "motel", "stay"],
  field: ["field", "facility", "venue", "park", "complex", "diamond", "location"],
  food: ["restaurant", "dining", "food", "eat", "lunch", "dinner"],
  expense: ["expense", "receipt", "bill", "bought", "purchase", "spent", "spend", "invoice", "reimburse"],
  exempt: ["exempt", "exemption", "waive", "waived", "free", "scholarship", "excluded"],
  unpaid: ["unpaid", "outstanding", "behind", "late", "overdue"],
  delete: ["delete", "remove", "erase"],
  print: ["print", "pdf", "printable", "handout"],
  income: ["income", "fundraiser", "fundraising", "sponsor", "sponsorship", "donation", "raised"],
  coach: ["coach", "assistant", "manager", "staff"],
  setup: ["setup", "begin", "started", "start", "new"],
  season: ["season", "year"],
  file: ["file", "document", "doc", "waiver", "paperwork", "form"],
  left: ["left", "quit", "leave", "gone", "departed", "inactive"],
  note: ["note", "notes", "comment", "comments", "memo", "remark"],
};
const CANON = new Map();
for (const [canon, words] of Object.entries(SYNONYMS)) for (const w of words) CANON.set(w, canon);

function singular(w) {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Lowercase, unify apostrophes, collapse phrases, split into words. */
export function words(text) {
  let s = String(text ?? "").toLowerCase().replace(/[’']/g, "");
  for (const [re, rep] of PHRASES) s = s.replace(re, rep);
  return s.split(/[^a-z0-9]+/).filter(Boolean);
}

/** Canonical tokens: stop words dropped, negation unified, synonyms mapped. */
export function tokens(text, { keepStop = false } = {}) {
  const out = [];
  for (const w of words(text)) {
    if (NEGATION.has(w)) { out.push("not"); continue; }
    if (!keepStop && STOP.has(w)) continue;
    const canon = CANON.get(w) ?? CANON.get(singular(w)) ?? singular(w);
    out.push(canon);
  }
  return out;
}

/** Damerau-Levenshtein (optimal string alignment), small strings only. */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** How well one query token matches a set of document tokens: 1, 0.7 or 0. */
function tokenMatch(q, set) {
  if (set.has(q)) return 1;
  if (q === "not") return 0; // negation must match exactly
  if (q.length >= 4) {
    for (const t of set) if (t.length > q.length && t.startsWith(q)) return 0.8;
    const allowed = q.length >= 8 ? 2 : 1;
    for (const t of set) {
      if (t.length >= 4 && distance(q, t) <= allowed) return 0.7;
      // A typo of a synonym ("venmmo", "exmpt") maps through to its canonical token.
    }
    for (const [w, canon] of CANON) if (set.has(canon) && w.length >= 4 && distance(q, w) <= allowed) return 0.7;
  }
  return 0;
}

/* ---------------- index ---------------- */

const FIELD_WEIGHT = { title: 3, keywords: 2, text: 1 };

function entry(kind, fields, meta) {
  return {
    kind,
    ...meta,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, new Set(tokens(v))])),
    phrase: tokens(`${fields.title} ${fields.keywords ?? ""}`).join(" "),
  };
}

const INDEX = [
  ...HELP_ANSWERS.map((a) =>
    entry("answer", { title: a.title, keywords: a.keywords, text: a.answer }, {
      id: a.id, title: a.title, text: a.answer, href: `/help?a=${a.id}`, action: a.action ?? null, guide: a.guide, rank: 0,
    })
  ),
  ...HELP_GUIDES.flatMap((g) =>
    g.steps.map((s) =>
      entry("step", { title: s.title, keywords: "", text: s.text }, {
        id: `${g.slug}#${s.id}`, title: s.title, text: s.text, href: `/help/${g.slug}#${s.id}`,
        action: s.action ?? null, guide: `${g.slug}#${s.id}`, guideTitle: g.title, rank: 1,
      })
    )
  ),
  ...HELP_GUIDES.map((g) =>
    entry("guide", { title: g.title, keywords: g.keywords ?? "", text: g.summary }, {
      id: g.slug, title: g.title, text: g.summary, href: `/help/${g.slug}`, action: null, guide: g.slug, rank: 2,
    })
  ),
];

/**
 * The one search entry point. Returns null for an empty query, otherwise
 * results best first: { kind, id, title, text, href, action, guide, guideTitle }.
 */
export function askHelp(query, { limit = 6 } = {}) {
  const q = tokens(query);
  if (q.length === 0) return null;
  // De-duplicated query tokens; a token repeated by synonyms counts once.
  const terms = [...new Set(q)];
  const phrase = q.join(" ");

  const scored = [];
  for (const e of INDEX) {
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      let best = 0;
      for (const [field, set] of Object.entries(e.fields)) {
        const m = tokenMatch(t, set);
        if (m) best = Math.max(best, m * FIELD_WEIGHT[field]);
      }
      if (best) { matched += 1; score += best; }
    }
    const coverage = matched / terms.length;
    // Everything typed must count for something on short queries; longer,
    // chattier questions may leave one word unmatched.
    const needed = terms.length <= 2 ? 1 : 0.6;
    if (coverage < needed || score === 0) continue;
    if (terms.includes("not") && !Object.values(e.fields).some((s) => s.has("not"))) score -= 2;
    if (phrase.length > 6 && e.phrase.includes(phrase)) score += 3;
    score += coverage * 4 - e.rank * 1.5;
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const out = [];
  for (const { e } of scored) {
    // A guide step already covered by an answer above it adds nothing.
    const key = e.kind === "answer" ? e.id : e.guide;
    if (seen.has(key) || seen.has(e.href)) continue;
    if (e.kind === "answer") seen.add(e.guide);
    seen.add(key);
    seen.add(e.href);
    const { fields, phrase: _p, rank: _r, ...result } = e;
    out.push(result);
    if (out.length >= limit) break;
  }
  return out;
}

export { findAnswer };
