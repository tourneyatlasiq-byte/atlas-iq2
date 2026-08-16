/**
 * Facility import: CSV parsing and row normalization.
 *
 * Pure — no server imports — so the client can parse and preview a file before
 * anything is sent. Facilities are never hardcoded into migrations or
 * application code; the master list lives in CSV and is imported through this.
 */

/**
 * Template columns, in order. The example row in FacilityImport must stay the
 * same length — a mismatch shifts every column.
 *
 * The last column was renamed from Notes to Description. It has always written
 * to facilities.description, which is shared with every organization, and the
 * old label invited people to type private team observations into a public
 * field. The parser still accepts the old header, so templates downloaded
 * before this change keep importing correctly.
 */
export const IMPORT_COLUMNS = [
  "Facility Name",
  "Address",
  "City",
  "State",
  "ZIP",
  "County",
  "Website",
  "Maps URL",
  "Latitude",
  "Longitude",
  "Number of Fields",
  "Surface",
  "Indoor",
  "Lights",
  "Batting Cages",
  "Concessions",
  "Restrooms",
  "Playground",
  "Parking",
  "Source",
  "Description",
];

const SURFACES = ["Grass", "Turf", "Mixed", "Unknown"];

const YES = ["yes", "y", "true", "t", "1", "x"];
const NO = ["no", "n", "false", "f", "0", "none"];

/**
 * RFC 4180-ish CSV parser: handles quoted fields, embedded commas, escaped
 * quotes ("") and both line ending styles. Written out rather than pulled in
 * as a dependency because the format we accept is narrow and known.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const src = text.replace(/^\uFEFF/, ""); // strip BOM from Excel exports

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }

  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);

  return rows;
}

const headerKey = (h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** Accepts reasonable header variations rather than demanding exact wording. */
const HEADER_ALIASES = {
  facilityname: "name",
  name: "name",
  facility: "name",
  streetaddress: "street_address",
  address: "street_address",
  street: "street_address",
  city: "city",
  state: "state",
  st: "state",
  zip: "zip",
  zipcode: "zip",
  postalcode: "zip",
  website: "website",
  url: "website",
  mapslink: "maps_link",
  mapsurl: "maps_link",
  map: "maps_link",
  maplink: "maps_link",
  mapurl: "maps_link",
  county: "county",
  fieldcount: "field_count",
  fields: "field_count",
  numberoffields: "field_count",
  surfacetype: "surface_type",
  surface: "surface_type",
  latitude: "latitude",
  lat: "latitude",
  longitude: "longitude",
  lng: "longitude",
  lon: "longitude",
  indoor: "indoor",
  indoorfacility: "indoor",
  lights: "lights",
  lighted: "lights",
  battingcages: "batting_cages",
  cages: "batting_cages",
  concessions: "concessions",
  concessionstand: "concessions",
  restrooms: "restrooms",
  bathrooms: "restrooms",
  playground: "playground",
  parking: "parking",
  source: "data_source",
  datasource: "data_source",
  // "Notes" is the legacy header for this column, kept so templates downloaded
  // before the rename still import. New templates emit "Description".
  notes: "description",
  description: "description",
};

export function normalizeName(name) {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Word tokens for near-duplicate detection.
 *
 * Substring matching is not enough: "Al Bishop Complex" is not a substring of
 * "Al Bishop Softball Complex" because of the inserted word, and the same
 * happens with "Heritage Point Park" vs "Heritage Point Regional Park". Both
 * are real duplicates in the Georgia batch. Comparing word sets catches them.
 */
export function nameTokens(name) {
  return new Set(
    (name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
  );
}

/** True when one name's words are wholly contained in the other's. */
export function tokensOverlap(a, b) {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (A.size === 0 || B.size === 0) return false;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

/** Street addresses, normalized past the usual Drive/Dr, Road/Rd variation. */
export function normalizeAddress(addr) {
  if (!addr) return null;
  const n = addr
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(highway|hwy)\b/g, "hwy")
    .replace(/\b(parkway|pkwy)\b/g, "pkwy")
    .replace(/\b(north|n)\b/g, "n")
    .replace(/\b(south|s)\b/g, "s")
    .replace(/\b(east|e)\b/g, "e")
    .replace(/\b(west|w)\b/g, "w")
    .replace(/\s+/g, " ")
    .trim();
  return n === "" ? null : n;
}

const clean = (v) => {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
};

function toInt(v) {
  const s = clean(v);
  if (s === null) return { value: null };
  const n = Number.parseInt(s.replace(/[^0-9-]/g, ""), 10);
  if (Number.isNaN(n) || n < 0) return { value: null, warning: `field count "${s}" isn't a number` };
  return { value: n };
}

function toDecimal(v, label, min, max) {
  const s = clean(v);
  if (s === null) return { value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max) {
    return { value: null, warning: `${label} "${s}" isn't valid` };
  }
  return { value: n };
}

function toSurface(v) {
  const s = clean(v);
  if (s === null) return { value: null };
  const match = SURFACES.find((x) => x.toLowerCase() === s.toLowerCase());
  if (match) return { value: match };
  // Don't reject a whole row over a surface label — record it as Unknown and say so.
  return { value: "Unknown", warning: `surface "${s}" isn't recognised, set to Unknown` };
}

function toBool(v, label) {
  const s = clean(v);
  if (s === null) return { value: null };
  const l = s.toLowerCase();
  if (YES.includes(l)) return { value: true };
  if (NO.includes(l)) return { value: false };
  return { value: null, warning: `${label} "${s}" isn't yes or no, left unknown` };
}

function toState(v) {
  const s = clean(v);
  if (s === null) return { value: null };
  if (s.length === 2) return { value: s.toUpperCase() };
  return { value: s.slice(0, 2).toUpperCase(), warning: `state "${s}" shortened to two letters` };
}

/**
 * Turns raw CSV into facility rows, carrying per-row warnings and errors.
 * Every row is returned — nothing is silently dropped — so the report can
 * account for the whole file.
 */
export function rowsFromCsv(text) {
  return rowsFromGrid(parseCsv(text));
}

/**
 * Same validation for Excel and CSV — the grid is the common shape, so a file
 * format can never change which rows are accepted.
 */
export function rowsFromGrid(raw) {
  if (raw.length === 0) return { headers: [], rows: [], fatal: "The file is empty." };

  const headers = raw[0].map((h) => HEADER_ALIASES[headerKey(h)] ?? null);

  if (!headers.includes("name")) {
    return {
      headers: raw[0],
      rows: [],
      fatal: "No facility name column found. The first row must be headers, including 'Facility Name'.",
    };
  }

  const rows = raw.slice(1).map((cells, i) => {
    const get = (key) => {
      const idx = headers.indexOf(key);
      return idx === -1 ? null : cells[idx];
    };

    const warnings = [];
    const collect = (r) => {
      if (r.warning) warnings.push(r.warning);
      return r.value;
    };

    const name = clean(get("name"));
    const state = collect(toState(get("state")));

    const row = {
      lineNumber: i + 2, // 1-indexed, plus the header row
      name,
      street_address: clean(get("street_address")),
      city: clean(get("city")),
      state,
      zip: clean(get("zip")),
      website: clean(get("website")),
      maps_link: clean(get("maps_link")),
      field_count: collect(toInt(get("field_count"))),
      surface_type: collect(toSurface(get("surface_type"))),
      latitude: collect(toDecimal(get("latitude"), "latitude", -90, 90)),
      longitude: collect(toDecimal(get("longitude"), "longitude", -180, 180)),
      county: clean(get("county")),
      indoor: collect(toBool(get("indoor"), "indoor")),
      lights: collect(toBool(get("lights"), "lights")),
      batting_cages: collect(toBool(get("batting_cages"), "batting cages")),
      concessions: collect(toBool(get("concessions"), "concessions")),
      restrooms: collect(toBool(get("restrooms"), "restrooms")),
      playground: collect(toBool(get("playground"), "playground")),
      parking: clean(get("parking")),
      data_source: clean(get("data_source")),
      description: clean(get("description")),
      warnings,
      error: null,
    };

    if (!row.name) row.error = "Facility name is required";
    else if (!row.city) row.error = "City is required to match against existing facilities";
    else if (!row.state) row.error = "State is required to match against existing facilities";

    return row;
  });

  return { headers, rows, fatal: null };
}
