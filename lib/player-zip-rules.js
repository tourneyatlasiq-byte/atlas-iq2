/**
 * ZIP-assisted City/State for the Player form. Pure rules, no I/O.
 *
 * Every decision lives here so the form, the server action and the checks
 * agree by construction (scripts/check-player-zip.js drives these directly).
 *
 * THE RULES
 *   - A lookup uses the first five digits of a 5-digit ZIP or ZIP+4.
 *   - A blank City or State is filled from the lookup.
 *   - A City or State still holding the value a previous lookup put there may
 *     be refreshed when the ZIP changes.
 *   - Anything the coach typed, and anything already on a saved player, is
 *     never overwritten. A differing result is offered as a suggestion.
 *   - Address lines are not part of this model at all, so they cannot be
 *     changed by it.
 *   - A response for a ZIP that is no longer in the field is ignored.
 *   - Nothing here can block saving: it only ever changes field values.
 */

import { US_STATES } from "./facility-fields";

/**
 * The five digits to look up, or null.
 *
 * Accepts "30303", "30303-1234", "30303 1234", "303031234", and a ZIP+4 that
 * is still being typed ("30303-12"), so adding the +4 never re-triggers or
 * cancels the lookup. Anything else is malformed and is not looked up.
 */
export function lookupZipKey(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{5})(?:[-\s]?\d{0,4})?$/);
  return m ? m[1] : null;
}

/** A two-letter code we offer in the State list, else null. */
export function knownStateCode(v) {
  const code = String(v ?? "").trim().toUpperCase();
  return US_STATES[code] ? code : null;
}

const blank = (v) => String(v ?? "").trim() === "";
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/**
 * The one usable answer in a list of normalised Geocodio candidates.
 *
 * Usable means: the returned ZIP is exactly the ZIP asked for, and it names a
 * city and a state we recognise. Anything else is "no match" — a ZIP that came
 * back as a different ZIP describes somewhere else.
 */
export function pickZipMatch(candidates, zip5) {
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const state = knownStateCode(c?.state);
    if (c?.zip === zip5 && !blank(c?.city) && state) {
      return { zip: zip5, city: String(c.city).trim(), state };
    }
  }
  return null;
}

/* --------------------------------------------------------------- form state */

/**
 * Starting state from the player record (or a blank Add form).
 *
 * `auto` records the value a lookup last wrote. A field counts as automatic
 * only while its value still equals `auto`. Saved values start with
 * auto = null, so an existing address is always treated as the coach's own.
 */
export function initZipForm(p = {}) {
  return {
    city: { value: p.city ?? "", auto: null },
    state: { value: p.state ?? "", auto: null },
    zip: p.zip ?? "",
    status: "idle", // idle | looking | no_match | unavailable
    suggestion: null, // { zip, city, state } when a result differs from the coach's values
  };
}

const isAuto = (f) => f.auto !== null && f.value === f.auto;

/** Fill or suggest, given a usable result for the ZIP currently in the field. */
export function applyZipMatch(form, match) {
  const next = { ...form, status: "idle", suggestion: null };
  let conflict = false;
  for (const key of ["city", "state"]) {
    const f = form[key];
    if (blank(f.value) || isAuto(f)) {
      next[key] = { value: match[key], auto: match[key] };
    } else if (!same(f.value, match[key])) {
      conflict = true;
    }
  }
  if (conflict) next.suggestion = { ...match };
  return next;
}

/**
 * The form's reducer. Actions:
 *   { type: "zip", value }               coach edited ZIP
 *   { type: "city" | "state", value }    coach edited City or State
 *   { type: "looking", key }             a lookup started for `key`
 *   { type: "result", key, result }      a lookup answered for `key`
 *   { type: "acceptSuggestion" } / { type: "dismissSuggestion" }
 */
export function zipFormReducer(form, action) {
  switch (action.type) {
    case "zip": {
      const before = lookupZipKey(form.zip);
      const after = lookupZipKey(action.value);
      if (before === after) return { ...form, zip: action.value };
      // A different ZIP: whatever we said about the old one no longer applies.
      return { ...form, zip: action.value, status: "idle", suggestion: null };
    }
    case "city":
    case "state": {
      const next = { ...form, [action.type]: { value: action.value, auto: null } };
      // A suggestion the coach has now typed in themselves is no longer needed.
      const s = form.suggestion;
      if (s && same(next.city.value, s.city) && same(next.state.value, s.state)) next.suggestion = null;
      return next;
    }
    case "looking":
      if (action.key !== lookupZipKey(form.zip)) return form;
      return { ...form, status: "looking" };
    case "result": {
      // Stale guard. The controller already drops superseded responses; this
      // makes the form itself refuse an answer for a ZIP it no longer holds.
      if (!action.key || action.key !== lookupZipKey(form.zip)) return form;
      const r = action.result ?? {};
      if (r.status === "match" && r.zip === action.key) {
        return applyZipMatch(form, { city: r.city, state: r.state, zip: r.zip });
      }
      if (r.status === "no_match") return { ...form, status: "no_match", suggestion: null };
      return { ...form, status: "unavailable", suggestion: null };
    }
    case "acceptSuggestion": {
      const s = form.suggestion;
      if (!s) return form;
      return {
        ...form,
        city: { value: s.city, auto: s.city },
        state: { value: s.state, auto: s.state },
        suggestion: null,
      };
    }
    case "dismissSuggestion":
      return { ...form, suggestion: null };
    default:
      return form;
  }
}

/* ---------------------------------------------------------- request control */

/**
 * Issues lookups and delivers only the newest answer.
 *
 * `lookup(zip5)` returns a promise of a result; a rejection is reported as
 * { status: "unavailable" }. `initialKey` is the ZIP already on a saved
 * player, so opening Edit never spends a lookup on a ZIP nobody changed.
 */
export function createZipLookupController(lookup, initialKey = null) {
  let seq = 0;
  let lastKey = initialKey;
  return {
    request(raw, onResult) {
      const key = lookupZipKey(raw);
      if (key === lastKey) return { started: false, key };
      lastKey = key;
      const mine = ++seq;
      if (!key) return { started: false, key: null };
      Promise.resolve()
        .then(() => lookup(key))
        .then(
          (result) => { if (mine === seq) onResult(key, result); },
          () => { if (mine === seq) onResult(key, { status: "unavailable" }); }
        );
      return { started: true, key };
    },
    /** Drop anything in flight (the form closed). */
    cancel() {
      seq++;
    },
  };
}
