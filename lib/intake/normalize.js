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
const MONTH_NAMES = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Rejects 30 February without consulting a Date, which would roll it to March. */
function calendarDate(y, m, d) {
  if (!(y >= 1900 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1)) return null;
  const lastDay = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
                   31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > lastDay) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * A date of birth, as a date-only value.
 *
 * SLASHES MEAN MONTH/DAY/YEAR. Season Tempo shows dates as MM/DD/YYYY
 * everywhere, so a coach typing 05/02/2010 means 2 May. That reading is fixed
 * in code rather than left to the runtime's locale: the same file imported on
 * a laptop set to en-GB must not become 5 February.
 *
 * The importer previously had no slash branch at all — 05/02/2010 fell through
 * to null, blocked the row, and told the coach their own date format was
 * unreadable while suggesting they convert to the database's internal
 * representation. The database still stores YYYY-MM-DD; that is an internal
 * detail a coach should never have to type.
 *
 * NO new Date(string) ANYWHERE. Its string parsing is implementation-defined
 * outside the ISO form, and for a date of birth an off-by-one or a locale flip
 * is a silent corruption. Every branch below computes the parts explicitly.
 *
 * Impossible dates block. Anything that cannot be read under these rules
 * blocks. Neither is ever guessed at.
 */
export function toDate(v) {
  if (v === null || v === undefined || v === "") return null;

  // An Excel date cell arrives as a real Date (cellDates: true). iso() reads
  // its LOCAL parts — toISOString() would shift the calendar day backwards for
  // anyone west of UTC, which is most of this product's users.
  if (v instanceof Date && !Number.isNaN(v.valueOf())) return iso(v);

  const s = String(v).trim();

  // Canonical, and what the database holds.
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) {
    return calendarDate(+isoMatch[1], +isoMatch[2], +isoMatch[3]);
  }

  // MM/DD/YYYY and M/D/YYYY — the format the product itself displays.
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    return calendarDate(+slash[3], +slash[1], +slash[2]);
  }

  // "Apr 3, 2010" / "3 April 2010" — a month name removes the ambiguity, so
  // both orders are safe. Parsed from an explicit table, not by Date.
  const named = /^(\d{1,2})?\s*[-,. ]?\s*([a-z]{3,9})\.?\s*[-,. ]?\s*(\d{1,2})?,?\s*(\d{4})$/i.exec(s);
  if (named) {
    const month = MONTH_NAMES[named[2].toLowerCase()];
    const day = named[1] ? +named[1] : named[3] ? +named[3] : null;
    if (month && day) return calendarDate(+named[4], month, day);
  }

  return null;                       // unreadable under our rules — blocks
}

/**
 * Tell "not given" apart from "we cannot read this".
 *
 * toDate() returns null for both, which is right for storage and wrong for a
 * coach: a blank cell needs no action, while "04/03/2010" is a real date we
 * refuse to guess at — 4 March or 3 April depending on where the file came
 * from. Silently dropping it means the coach believes a date of birth
 * imported when nothing was written, and readiness then reports the player as
 * missing one.
 */
export function classifyDate(v) {
  if (v === null || v === undefined || String(v).trim() === "") {
    return { ok: true, value: null, raw: null };
  }
  // iso(), not toISOString(): the value shown back to the coach must be the
  // calendar day they meant, not that day shifted into UTC.
  const raw = v instanceof Date ? iso(v) : String(v).trim();
  const value = toDate(v);
  if (value) return { ok: true, value, raw };
  return { ok: false, value: null, raw };
}

/**
 * Values a coach supplied that we could not read.
 *
 * Called by BOTH the browser preview and the server action, from here, so the
 * two cannot disagree about whether a row is importable. A client that blocked
 * a row the server allowed — or the reverse — is the exact failure this
 * codebase has already paid for once.
 *
 * Reserved key on the row, not a field, so the registry loop skips it.
 */
export function unreadableValues(rawRow = {}, fieldFor = () => null) {
  const out = [];
  for (const [key, value] of Object.entries(rawRow)) {
    if (key === "contacts" || key.startsWith("_")) continue;
    const field = fieldFor(key);
    if (!field || field.type !== "date") continue;
    const c = classifyDate(value);
    if (!c.ok) out.push({ key, label: field.label, raw: c.raw });
  }
  return out;
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

/**
 * Preferred contact method, spoken to the stored vocabulary.
 *
 * player_contacts.preferred_method is CHECK-constrained to text | email | call
 * | NULL, and the check is case-sensitive lowercase — so "Email", the most
 * natural thing for a form to export, fails it. A coach import reached the
 * database with an unrecognised value and the CHECK was the FIRST thing to
 * validate it, which surfaced as a raw constraint error at the end of an
 * otherwise successful import.
 *
 * DELIBERATELY NARROW. "Either", "Any", "Both", "Cell", "Mobile" and the like
 * are NOT mapped: a coach writing "Either" has not told us which, and guessing
 * would store a preference they never expressed. Those block the row for
 * review instead, with the value they actually typed.
 */
const CONTACT_METHOD = {
  text: "text", texting: "text", sms: "text", "text message": "text",
  "text messages": "text", "text msg": "text",
  email: "email", "e-mail": "email", "e mail": "email", emails: "email",
  call: "call", phone: "call", "phone call": "call", "call me": "call",
  "phone call": "call", telephone: "call", voice: "call",
};

/** null for blank, the mapped value, or null when unrecognised. */
export function toContactMethod(v) {
  return CONTACT_METHOD[String(v ?? "").trim().toLowerCase()] ?? null;
}

/**
 * Classify a raw value so the UI can tell "not given" from "not understood".
 *
 * toContactMethod() returns null for both, which is right for storage and
 * useless for a coach: one needs no action, the other needs their attention.
 */
export function classifyContactMethod(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return { ok: true, value: null, raw: null };
  const mapped = CONTACT_METHOD[raw.toLowerCase()];
  if (mapped) return { ok: true, value: mapped, raw };
  return { ok: false, value: null, raw };
}

/** The stored vocabulary, for anything that needs to assert against it. */
export const CONTACT_METHODS = ["text", "email", "call"];

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
    // The raw value is PRESERVED here, not silently dropped: the review
    // step needs to show a coach exactly what their file said. It is
    // converted, or refused, in buildRowPlan().
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
