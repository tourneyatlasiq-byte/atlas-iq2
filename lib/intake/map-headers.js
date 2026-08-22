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


/**
 * Does the first row look like headers, or like data?
 *
 * A file exported from something else usually has headers. A file a coach
 * typed may not. Guessing wrong in either direction is bad, so this only
 * decides which QUESTION to ask — the coach can always say the file has no
 * headers, and mapping is manual from there.
 */
export function looksLikeHeaders(firstRow = [], secondRow = []) {
  const cells = firstRow.map((c) => String(c ?? "").trim()).filter(Boolean);
  if (cells.length === 0) return false;

  // Mostly numbers, or values that parse as dates, reads as data.
  const numeric = cells.filter((c) => /^\d+([.,]\d+)?$/.test(c)).length;
  if (numeric / cells.length > 0.4) return false;

  // A recognised field name is strong evidence either way.
  const recognised = suggestMappings(firstRow).mappings.length;
  if (recognised >= Math.max(2, Math.ceil(cells.length * 0.3))) return true;

  // If row one and row two look alike in shape, row one is probably data.
  const shape = (r) => r.map((c) => (/^\d+$/.test(String(c ?? "").trim()) ? "n" : "t")).join("");
  if (secondRow.length && shape(firstRow) === shape(secondRow)) return false;

  return recognised > 0;
}

/** A, B, C … for a file the coach says has no headers. */
export function columnLabels(count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    let n = i;
    let label = "";
    do { label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26) - 1; }
    while (n >= 0);
    out.push(`Column ${label}`);
  }
  return out;
}

/**
 * Every field a coach may choose from, grouped for a select.
 *
 * Auto-detection is a convenience; this is the authority. A general importer
 * cannot require anyone to name a column exactly "Graduation Year".
 */
export function selectableFields() {
  const groups = new Map();
  for (const f of FIELDS) {
    if (!f.importable || isIgnored(f.key)) continue;
    const g = f.level === "season" ? "This season"
      : f.level === "contact" ? "Parent or guardian"
      : f.level === "link" ? "Links" : "Player";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ key: f.key, label: f.label, repeatable: Boolean(f.repeatable),
                         optIn: f.optIn, sensitive: f.sensitive });
  }
  return [...groups.entries()].map(([group, fields]) => ({ group, fields }));
}
