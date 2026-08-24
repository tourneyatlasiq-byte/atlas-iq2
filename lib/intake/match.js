/**
 * Matching — people, then their contacts.
 *
 * The rule that matters most: CONFLICT IS NOT NEW. A name that matches an
 * existing player while a date of birth or graduation year disagrees is a
 * question for the coach, never permission to create a second person. A typo
 * or a stale grad year must not be able to fork a player record.
 *
 * Jersey number is never an input to identity. It is season-scoped and reused
 * every year.
 */

import { normName, normEmail, normPhone, composeFullName } from "./normalize.js";

export const CLASS = {
  CONFIDENT: "confident",
  POSSIBLE: "possible",
  CONFLICT: "conflict",
  NEW: "new",
  INVALID: "invalid",
};

/**
 * THE MATCHING EVIDENCE, named once.
 *
 * Every field matchPlayer() actually reads off an existing player. Both the
 * browser preview and the server action build their candidates through
 * toCandidate() below, so the two cannot be given different evidence.
 *
 * They were. The client passed resolved contacts; the server's select had no
 * contacts at all, and its candidates were missing the structured name columns
 * that nameKeys() reads. A player whose only corroboration was an email in
 * player_contacts therefore classified `confident` in the browser and
 * `possible` on the server — so the coach resolved everything he was shown,
 * Ready reported nothing outstanding, and Import then refused a row he had
 * never been asked about.
 */
export const MATCH_EVIDENCE = [
  "id", "full_name", "legal_first_name", "preferred_first_name", "last_name",
  "grad_year", "date_of_birth", "parent_email", "contacts",
];

/**
 * Guarantee the matching evidence WITHOUT discarding the record.
 *
 * This returns the player it was given, plus normalised matching fields. It is
 * deliberately NOT a reduced projection: match.candidate becomes buildRowPlan's
 * `existingPlayer`, and planning diffs the incoming row against that record. An
 * earlier version returned only the nine matching fields, so the seven planning
 * columns it dropped had no stored value to compare against — an incoming
 * `bats` looked like a FILL rather than a CONFLICT, and a coach's stored value
 * would have been overwritten with no decision shown.
 *
 * Matching may use a normalised VIEW of a player. Planning must keep the whole
 * player. One object serves both, so it has to be the superset.
 *
 * `contacts` is normalised because the two sources spell it differently: a
 * PostgREST embed arrives as `player_contacts`, the drawer resolves it as
 * `contacts`. matchPlayer() reads `candidate.contacts`, so fetching the rows is
 * not enough — they must arrive under the name it reads.
 */
export function toCandidate(player = {}) {
  const contacts = player.contacts ?? player.player_contacts ?? [];
  return {
    // EVERY property of the original survives, including planning columns and
    // anything a future caller adds.
    ...player,
    // Matching evidence, guaranteed present rather than merely usually present.
    id: player.id ?? null,
    full_name: player.full_name ?? null,
    legal_first_name: player.legal_first_name ?? null,
    preferred_first_name: player.preferred_first_name ?? null,
    last_name: player.last_name ?? null,
    grad_year: player.grad_year ?? null,
    date_of_birth: player.date_of_birth ?? null,
    parent_email: player.parent_email ?? null,
    contacts: (contacts ?? []).map((c) => ({ ...c, id: c.id ?? null, email: c.email ?? null })),
  };
}

/** Every spelling of an existing player worth comparing against. */
function nameKeys(p = {}) {
  const keys = new Set();
  const add = (v) => { const k = normName(v); if (k) keys.add(k); };
  add(p.full_name);
  add(composeFullName(p));
  if (p.last_name) {
    add(`${p.legal_first_name ?? ""} ${p.last_name}`);
    add(`${p.preferred_first_name ?? ""} ${p.last_name}`);
  }
  return keys;
}

/** Same words in any order — "Bohannon Aubrey" is "Aubrey Bohannon". */
function sameWords(a, b) {
  const x = a.split(" ").filter(Boolean).sort().join(" ");
  const y = b.split(" ").filter(Boolean).sort().join(" ");
  return x === y && x.length > 0;
}

/** Levenshtein distance, capped: we only care whether it is small. */
function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * A near-miss spelling, PROPOSED not accepted.
 *
 * A real roster had "Carlyann" in Season Tempo and "Carlyanne" in the
 * spreadsheet; the importer called it a new player and would have created a
 * duplicate. One or two characters out on a name of reasonable length is worth
 * showing the coach.
 *
 * Deliberately conservative: short names are excluded, because two characters
 * out of five is a different person, and this only ever produces a candidate
 * for confirmation — never a merge.
 */
function nearMiss(a, b) {
  if (!a || !b || a === b) return false;
  const len = Math.max(a.length, b.length);
  if (len < 6) return false;
  const allowed = len >= 12 ? 2 : 1;
  return editDistance(a, b, allowed) <= allowed;
}

/**
 * Corroborators. Each is compared only when BOTH sides hold a value: a blank
 * in the file is not disagreement.
 */
function corroborate(row, player, playerContacts = []) {
  const agree = [];
  const disagree = [];

  if (row.date_of_birth && player.date_of_birth) {
    (row.date_of_birth === player.date_of_birth ? agree : disagree).push("date of birth");
  }
  if (row.grad_year && player.grad_year) {
    (Number(row.grad_year) === Number(player.grad_year) ? agree : disagree).push("graduation year");
  }

  /**
   * Contact email AGREES usefully but never DISAGREES about identity.
   *
   * A parent changing address, a second guardian filling in the form, a work
   * address in one place and a personal one in the other — none of those make
   * the child a different person. The real test showed exactly this: matching
   * name, matching date of birth, different parent email, and the row was
   * being flagged as a conflict.
   *
   * A differing email is a CONTACT question, answered separately once the
   * player is confirmed.
   */
  const rowEmails = (row.contacts ?? []).map((c) => normEmail(c.email)).filter(Boolean);
  const known = new Set(
    [...playerContacts.map((c) => normEmail(c.email)), normEmail(player.parent_email)].filter(Boolean)
  );
  if (rowEmails.length && known.size && rowEmails.some((e) => known.has(e))) {
    agree.push("contact email");
  }

  return { agree, disagree };
}

/**
 * Classify one row against the organization's existing players.
 *
 * `existing` rows may carry `contacts: []`; absent, only the legacy
 * parent_email is available for corroboration.
 */
export function matchPlayer(row, existing = []) {
  // NORMALISED HERE, not left to callers. A caller that hand-built a partial
  // candidate is what caused the browser and the server to classify the same
  // player differently — the browser's objects had contacts but no structured
  // names, the server's had neither. Shaping every candidate on the way in
  // makes a partial one impossible rather than merely discouraged.
  existing = (existing ?? []).map(toCandidate);

  const rowName = normName(row.full_name ?? composeFullName(row));
  if (!rowName) {
    return { classification: CLASS.INVALID, candidate: null, reasons: ["no player name in this row"] };
  }

  const exact = [];
  const loose = [];
  for (const p of existing) {
    const keys = nameKeys(p);
    if (keys.has(rowName)) exact.push(p);
    else if ([...keys].some((k) => sameWords(k, rowName) || nearMiss(k, rowName))) loose.push(p);
  }

  const candidates = exact.length ? exact : loose;

  // No credible candidate at all.
  if (candidates.length === 0) {
    return { classification: CLASS.NEW, candidate: null, reasons: ["no existing player with this name"] };
  }

  // More than one namesake is always a decision.
  if (candidates.length > 1) {
    return {
      classification: CLASS.POSSIBLE,
      candidate: null,
      candidates,
      reasons: [`${candidates.length} existing players share this name`],
    };
  }

  const candidate = candidates[0];
  const { agree, disagree } = corroborate(row, candidate, candidate.contacts ?? []);

  // A disagreement NEVER produces NEW. It produces a question.
  if (disagree.length) {
    return {
      classification: CLASS.CONFLICT,
      candidate,
      reasons: [`name matches but ${disagree.join(" and ")} disagree`],
      disagree,
    };
  }

  if (agree.length && exact.length) {
    return { classification: CLASS.CONFIDENT, candidate, reasons: [`name and ${agree.join(", ")} agree`] };
  }

  if (agree.length && !exact.length) {
    return {
      classification: CLASS.POSSIBLE, candidate,
      reasons: [`${agree.join(", ")} agree but the name differs slightly`],
    };
  }

  return {
    classification: CLASS.POSSIBLE, candidate,
    reasons: exact.length
      ? ["name matches, nothing else to confirm it"]
      : ["the name is spelled slightly differently"],
  };
}

/* --- A6: contacts -------------------------------------------------------- */

export const CONTACT = { UPDATE: "update", REVIEW: "review", INSERT: "insert" };

/**
 * Match one imported contact against the matched player's existing contacts.
 *
 * Email may identify a person. A PHONE NUMBER MAY NOT, on its own: households
 * share numbers, and a parent and child often give the same one. A phone match
 * therefore requires a compatible name before it is treated as the same
 * contact; otherwise a coach looks at it.
 *
 * Scope is deliberately the matched player's own contacts. Cross-player
 * identity is a later design.
 */
export function matchContact(incoming, existingContacts = []) {
  const email = normEmail(incoming.email);
  const phone = normPhone(incoming.phone);
  const name = normName(incoming.full_name);

  if (email) {
    const hit = existingContacts.find((c) => normEmail(c.email) === email);
    if (hit) return { action: CONTACT.UPDATE, target: hit, reason: "same email" };
  }

  if (phone) {
    const byPhone = existingContacts.filter((c) => normPhone(c.phone) === phone);
    for (const c of byPhone) {
      const n = normName(c.full_name);
      if (name && n && (n === name || sameWords(n, name))) {
        return { action: CONTACT.UPDATE, target: c, reason: "same phone and name" };
      }
    }
    if (byPhone.length) {
      return {
        action: CONTACT.REVIEW, target: byPhone[0],
        reason: "same phone but a different name — numbers are often shared",
      };
    }
  }

  if (name) {
    const byName = existingContacts.filter((c) => {
      const n = normName(c.full_name);
      return n === name || sameWords(n, name);
    });
    if (byName.length) {
      return {
        action: CONTACT.REVIEW, target: byName[0],
        reason: "same name, but no matching email or phone",
      };
    }
  }

  return { action: CONTACT.INSERT, target: null, reason: "no existing contact matches" };
}
