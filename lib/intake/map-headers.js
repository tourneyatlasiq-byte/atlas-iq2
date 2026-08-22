/**
 * A2 — header mapping.
 *
 * Suggests a registry field for every column in an uploaded file. It consumes
 * the finalised registry and the normalisation rules; it has no vocabulary of
 * its own.
 *
 * CONTACT GROUPS ARE DISCOVERED, NOT ASSUMED. "Parent/Guardian 1 Full Name",
 * "Cell Phone (2)", "Guardian 3 Email" all resolve to the same repeatable
 * field at different indexes. Nothing is hard-coded to two guardians, because
 * two is a property of one organization's form rather than of the product.
 *
 * Unrecognised columns are reported as unmapped rather than dropped silently:
 * a coach should see that Season Tempo looked at a column and had no home for
 * it, and be able to map it themselves.
 */

import { FIELDS, BY_KEY, isIgnored } from "./registry.js";
import { normName } from "./normalize.js";

/** Pull a group index out of a header: "Guardian 2", "Email (2)", "Parent #3". */
function groupIndex(header) {
  const h = String(header ?? "");
  const paren = h.match(/\(\s*(\d+)\s*\)\s*$/);
  if (paren) return Number(paren[1]);
  const inline = h.match(/\b(?:parent|guardian|contact)\s*\/?\s*(?:guardian)?\s*#?\s*(\d+)\b/i);
  if (inline) return Number(inline[1]);
  return null;
}

/** Header text with any group marker removed, for matching. */
function baseHeader(header) {
  return normName(
    String(header ?? "")
      .replace(/\(\s*\d+\s*\)\s*$/, "")
      .replace(/\b(parent|guardian|contact)\s*\/?\s*(guardian)?\s*#?\s*\d+\b/gi, "$1 $2")
  );
}

const SYNONYM_INDEX = (() => {
  const idx = new Map();
  for (const field of FIELDS) {
    for (const syn of field.synonyms) {
      const k = normName(syn);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(field);
    }
    const k = normName(field.label);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(field);
  }
  return idx;
})();

/** Prefer a contact-level field when the header names a guardian. */
function pick(candidates, { isContactHeader }) {
  if (candidates.length === 1) return candidates[0];
  const contact = candidates.find((c) => c.level === "contact");
  const other = candidates.find((c) => c.level !== "contact");
  return isContactHeader ? contact ?? candidates[0] : other ?? candidates[0];
}

/**
 * @returns { mappings, unmapped, ignored, contactGroups, sensitive }
 *   mappings: [{ header, key, index, confidence, sensitive, autoEnabled }]
 */
export function suggestMappings(headers = []) {
  const mappings = [];
  const unmapped = [];
  const ignored = [];
  const groups = new Set();

  for (const header of headers) {
    const idxNum = groupIndex(header);
    const base = baseHeader(header);
    const raw = normName(header);
    const isContactHeader = /parent|guardian/i.test(String(header)) || idxNum !== null;

    let candidates = SYNONYM_INDEX.get(base) ?? SYNONYM_INDEX.get(raw) ?? null;

    // Fall back to a contained-phrase match, longest synonym first so
    // "primary position" beats "position".
    if (!candidates) {
      let best = null;
      let bestLen = 0;
      for (const [syn, fields] of SYNONYM_INDEX) {
        if (syn.length > bestLen && (base.includes(syn) || raw.includes(syn))) {
          best = fields; bestLen = syn.length;
        }
      }
      candidates = best;
    }

    if (!candidates) {
      unmapped.push(header);
      continue;
    }

    const field = pick(candidates, { isContactHeader });

    if (isIgnored(field.key)) {
      ignored.push({ header, key: field.key, label: field.label });
      continue;
    }

    const index = field.repeatable ? (idxNum ?? 1) : null;
    if (field.repeatable) groups.add(index);

    mappings.push({
      header,
      key: field.key,
      index,
      level: field.level,
      sensitive: field.sensitive,
      pendingMigration: field.pendingMigration,
      // Opt-in fields are recognised but never switched on for the coach.
      // Sensitive is a LABEL; opt-in is a gate, and only the date of birth
      // carries it. A parent email is sensitive and still auto-enabled,
      // because importing it is the reason the column was mapped.
      autoEnabled: !field.optIn,
      optIn: field.optIn,
      confidence: SYNONYM_INDEX.has(base) || SYNONYM_INDEX.has(raw) ? "exact" : "probable",
    });
  }

  return {
    mappings,
    unmapped,
    ignored,
    contactGroups: [...groups].sort((a, b) => a - b),
    sensitive: mappings.filter((m) => m.sensitive),
  };
}

/** Turn a spreadsheet row into registry-keyed values plus contacts[]. */
export function applyMappings(row = {}, mappings = [], { enabledKeys = null } = {}) {
  const out = {};
  const contacts = new Map();

  for (const m of mappings) {
    if (enabledKeys && !enabledKeys.has(`${m.key}${m.index ?? ""}`)) continue;
    const field = BY_KEY.get(m.key);
    if (!field) continue;

    const raw = row[m.header];
    if (raw === undefined) continue;

    if (field.level === "contact") {
      const g = contacts.get(m.index) ?? {};
      g[m.key.replace(/^contact_/, "")] = raw;
      contacts.set(m.index, g);
    } else {
      // Positions arrive across several columns and accumulate.
      if (field.type === "list") out[m.key] = [out[m.key], raw].filter(Boolean).join(";");
      else out[m.key] = raw;
    }
  }

  const list = [...contacts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, c]) => ({ index, full_name: c.name ?? null, relationship: c.relationship ?? null,
                            email: c.email ?? null, phone: c.phone ?? null,
                            preferred_method: c.preferred ?? null }))
    .filter((c) => c.full_name || c.email || c.phone);

  return { ...out, contacts: list };
}
