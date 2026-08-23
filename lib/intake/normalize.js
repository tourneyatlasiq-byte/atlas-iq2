/**
 * Value normalisation for intake, and the name composition rule.
 *
 * Everything here is pure. Comparison forms are used only for matching and are
 * never stored — the coach's own spelling and casing are what get written.
 */

import { POSITION_CODES } from "./registry.js";

/* --- comparison forms ---------------------------------------------------- */

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normName(v) {
  return String(v ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normEmail(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/\.+$/, "");
  return s.includes("@") ? s : null;
}

/**
 * Digits only, with a leading US country code dropped when eleven digits
 * remain. Ten digits or nothing: a partial number is not an identifier.
 */
export function normPhone(v) {
  let d = String(v ?? "").replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/* --- typed values -------------------------------------------------------- */

export function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Dates. An ambiguous numeric date is REJECTED rather than guessed: reading
 * 03/04/2010 as March or April is a coin flip, and this is a minor's date of
 * birth. Unambiguous ISO and named-month forms are accepted.
 */
export function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.valueOf())) return iso(v);

  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // "Apr 3, 2010" / "3 April 2010" — a month name removes the ambiguity.
  if (/[a-z]{3}/i.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.valueOf())) return iso(d);
  }
  return null;                       // ambiguous or unparseable
}

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Batting and throwing hand, in the codes the DATABASE stores.
 *
 * players_bats_check permits only 'R', 'L' or 'S', and players_throws_check
 * only 'R' or 'L'. An earlier version of this returned "Right"/"Left", which
 * every one of the 26 stored rows contradicts and which the check constraint
 * would have rejected — failing an entire atomic import on one cell.
 *
 * Anything unrecognised returns null rather than a guess: an unknown hand is
 * not worth failing an import over, and the field is optional.
 */
const HAND = {
  r: "R", right: "R", rh: "R", righty: "R", "right-handed": "R",
  l: "L", left: "L", lh: "L", lefty: "L", "left-handed": "L",
  s: "S", switch: "S", both: "S", "switch hitter": "S",
};

export function toHand(v) {
  const k = String(v ?? "").trim().toLowerCase();
  if (!k) return null;
  return HAND[k] ?? null;
}

/** Throwing hand. 'S' is meaningless for throwing, so it is refused. */
export function toThrowingHand(v) {
  const h = toHand(v);
  return h === "S" ? null : h;
}

const CONTACT_METHOD = { text: "text", sms: "text", email: "email", call: "call", phone: "call" };
export function toContactMethod(v) {
  return CONTACT_METHOD[String(v ?? "").trim().toLowerCase()] ?? null;
}

/**
 * Positions, spoken to codes.
 *
 * The application's vocabulary is P/C/1B/…/FLEX (lib/queries/roster.js) while
 * a parent-facing form says "Second Base" or "Utility". Anything unrecognised
 * is dropped rather than invented.
 */
const POSITION_WORDS = {
  pitcher: "P", p: "P",
  catcher: "C", c: "C",
  "first base": "1B", first: "1B", "1b": "1B",
  "second base": "2B", second: "2B", "2b": "2B",
  "third base": "3B", third: "3B", "3b": "3B",
  shortstop: "SS", short: "SS", ss: "SS",
  "left field": "LF", left: "LF", lf: "LF",
  "center field": "CF", "centre field": "CF", center: "CF", cf: "CF",
  "right field": "RF", right: "RF", rf: "RF",
  utility: "UTIL", util: "UTIL", "any": "UTIL",
  "designated player": "DP", dp: "DP",
  flex: "FLEX",
  outfield: "CF", infield: "UTIL",
};

export function toPositions(v) {
  if (v === null || v === undefined || v === "") return [];
  const parts = Array.isArray(v) ? v : String(v).split(/[;,/|]+/);
  const out = [];
  for (const raw of parts) {
    const k = normName(raw);
    if (!k) continue;
    const code = POSITION_CODES.includes(raw.trim().toUpperCase())
      ? raw.trim().toUpperCase()
      : POSITION_WORDS[k];
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

export const toText = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Route a raw cell through the normaliser its registry type calls for. */
export function normalizeValue(type, raw) {
  switch (type) {
    case "int": return toInt(raw);
    case "date": return toDate(raw);
    case "email": return normEmail(raw) ? String(raw).trim() : null;
    case "phone": return normPhone(raw) ? String(raw).trim() : null;
    case "list": return toPositions(raw);
    case "enum": return toText(raw);
    case "hand": return toHand(raw);
    case "throwing_hand": return toThrowingHand(raw);
    default: return toText(raw);
  }
}

/* --- A4: name composition ------------------------------------------------ */

/**
 * full_name is DERIVED from structured names when they exist, and left alone
 * when they do not.
 *
 * This is the whole synchronisation rule: structured names are authoritative
 * when present, so the four fields can never drift apart. A legacy record with
 * only a full_name is never forced into structured form — that is a per-record
 * decision, not a bulk migration.
 */
export function composeFullName(p = {}) {
  const first = toText(p.preferred_first_name) ?? toText(p.legal_first_name);
  const last = toText(p.last_name);
  if (first && last) return `${first} ${last}`;
  return toText(p.full_name);
}

/** Does this record hold structured names? */
export const hasStructuredName = (p = {}) =>
  Boolean(toText(p.last_name) && (toText(p.preferred_first_name) || toText(p.legal_first_name)));

/**
 * The invariant a checker asserts: a record either has structured names AND a
 * full_name derived from them, or has neither.
 */
export const nameIsConsistent = (p = {}) =>
  !hasStructuredName(p) || composeFullName(p) === toText(p.full_name);


/* --- Social handles ------------------------------------------------------ */

/**
 * An X handle, in whatever form a coach typed it.
 *
 * player_links.url is NOT NULL and the model stores a URL, so the handle
 * cannot simply be saved as given. The original string is preserved verbatim
 * in `label`; only `url` is composed.
 *
 * Accepts @user, user, x.com/user, twitter.com/user, and full URLs with or
 * without protocol or www. Returns null for anything it cannot resolve
 * confidently — a value that reaches Review is better than a fabricated
 * profile link.
 *
 * The username itself is never altered: no case folding, no trimming of
 * characters, no guessing at typos.
 */
export function parseXHandle(raw) {
  const original = String(raw ?? "").trim();
  if (!original) return null;

  let v = original;

  // Strip a protocol and host if one is present.
  const urlish = v.match(/^(?:https?:\/\/)?(?:www\.)?(?:mobile\.)?(x|twitter)\.com\/(.+)$/i);
  if (urlish) v = urlish[2];
  else if (/^(?:https?:\/\/)/i.test(v)) return null;   // some other site entirely

  // Drop a query string, fragment or trailing slash.
  v = v.split(/[?#]/)[0].replace(/\/+$/, "");

  // A path with more segments is a status or media link, not a profile.
  if (v.includes("/")) return null;

  v = v.replace(/^@+/, "");

  // X usernames: letters, digits and underscore, 1-15 characters.
  if (!/^[A-Za-z0-9_]{1,15}$/.test(v)) return null;

  return { handle: v, url: `https://x.com/${v}`, label: original };
}

/* --- Person type ---------------------------------------------------------
   VERIFIED against production: stored values are lowercase player | coach |
   manager | other. "staff" is a UI grouping and is never stored, so it is not
   accepted as an import value on its own.

   A named staff role resolves to a PAIR — person_type plus other_role_label —
   because that is how the roster form writes it. Anything unrecognised
   returns null and goes to review: person_type gates dues eligibility, lineup
   eligibility and roster counts across 21 call sites, so guessing it wrong
   silently removes someone from dues. */

const STAFF_ROLE_TYPES = {
  "head coach": "coach",
  "assistant coach": "coach",
  "team manager": "manager",
  "team parent": "other",
  treasurer: "other",
  "recruiting coordinator": "other",
};

export function parsePersonType(raw) {
  const v = normName(raw);
  if (!v) return null;

  if (v === "player" || v === "athlete") return { person_type: "player", other_role_label: null };
  if (v === "coach") return { person_type: "coach", other_role_label: null };
  if (v === "manager") return { person_type: "manager", other_role_label: null };

  const named = STAFF_ROLE_TYPES[v];
  if (named) {
    // Title-cased exactly as STAFF_ROLES stores it.
    const label = String(raw).trim().replace(/\s+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return { person_type: named, other_role_label: label };
  }

  // Includes "staff", which the application never stores.
  return null;
}
