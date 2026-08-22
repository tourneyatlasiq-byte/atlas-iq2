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

  const rowEmails = (row.contacts ?? []).map((c) => normEmail(c.email)).filter(Boolean);
  const known = new Set(
    [...playerContacts.map((c) => normEmail(c.email)), normEmail(player.parent_email)].filter(Boolean)
  );
  if (rowEmails.length && known.size) {
    (rowEmails.some((e) => known.has(e)) ? agree : disagree).push("contact email");
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
  const rowName = normName(row.full_name ?? composeFullName(row));
  if (!rowName) {
    return { classification: CLASS.INVALID, candidate: null, reasons: ["no player name in this row"] };
  }

  const exact = [];
  const loose = [];
  for (const p of existing) {
    const keys = nameKeys(p);
    if (keys.has(rowName)) exact.push(p);
    else if ([...keys].some((k) => sameWords(k, rowName))) loose.push(p);
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
    reasons: ["name matches, nothing else to confirm it"],
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
