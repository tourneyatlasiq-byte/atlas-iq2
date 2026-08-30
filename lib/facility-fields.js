/**
 * Correctable shared facility fields.
 *
 * Free of any server import so both server queries and client components can
 * use it. Keeping this out of lib/queries/facilities.js matters: that module
 * pulls in next/headers via the Supabase server client, and importing it from
 * a client component breaks the build.
 *
 * Only globally true facts appear here. Organization-private notes are absent
 * by design — they live in organization_facilities and must never enter the
 * shared audit trail.
 */

/**
 * The three kinds of place a team wants to remember.
 *
 * ONE VOCABULARY. The filters, the create form, the drawer and the database
 * CHECK constraint all read from here, so a fourth type is one edit rather
 * than a search for every place a string was written out.
 *
 * Services is deliberately absent from V1. A photographer or a bus company is
 * a business rather than a place: an address it may not have, coordinates that
 * mean nothing, and an atlas_id from a geographic sequence. It sits closer to
 * Contacts than to this table.
 */
export const RESOURCE_TYPES = [
  { key: "facility", label: "Facility", plural: "Facilities" },
  { key: "lodging", label: "Lodging", plural: "Lodging" },
  { key: "dining", label: "Dining", plural: "Dining" },
];

export const RESOURCE_TYPE_KEYS = RESOURCE_TYPES.map((t) => t.key);

const TYPE_LABEL = new Map(RESOURCE_TYPES.map((t) => [t.key, t.label]));

/** Unknown or missing reads as Facility, matching the column default. */
export function typeLabel(key) {
  return TYPE_LABEL.get(key) ?? "Facility";
}

/**
 * Operational fields that only make sense for a ballpark. A hotel has no
 * surface type and no batting cages, and showing those rows empty on a lodging
 * record is worse than not showing them.
 */
export const FACILITY_ONLY_FIELDS = [
  "field_count", "surface_type", "indoor", "lights", "batting_cages",
  "concessions", "restrooms", "playground", "parking",
];

export const isFacilityOnlyField = (key) => FACILITY_ONLY_FIELDS.includes(key);

/**
 * Would use again is stored as 'yes', 'no', or NULL. NULL IS "Not rated" —
 * there is deliberately no third stored value, because "not rated" is the
 * absence of a judgement rather than a judgement.
 */
export const WOULD_USE_AGAIN = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "", label: "Not rated" },
];

export function wouldUseAgainLabel(v) {
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return "Not rated";
}

export const EDITABLE_FIELDS = [
  { key: "name", label: "Name", type: "text" },
  { key: "street_address", label: "Street address", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "zip", label: "ZIP", type: "text" },
  { key: "county", label: "County", type: "text" },
  { key: "latitude", label: "Latitude", type: "number" },
  { key: "longitude", label: "Longitude", type: "number" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "website", label: "Website", type: "text" },
  { key: "maps_link", label: "Maps link", type: "text" },
  { key: "field_count", label: "Number of fields", type: "number" },
  { key: "surface_type", label: "Surface", type: "surface" },
  { key: "indoor", label: "Indoor", type: "bool" },
  { key: "lights", label: "Lights", type: "bool" },
  { key: "batting_cages", label: "Batting cages", type: "bool" },
  { key: "concessions", label: "Concessions", type: "bool" },
  { key: "restrooms", label: "Restrooms", type: "bool" },
  { key: "playground", label: "Playground", type: "bool" },
  { key: "parking", label: "Parking", type: "text" },
  { key: "description", label: "Description", type: "text" },
];

export const FIELD_LABELS = Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.key, f.label]));

export const FIELD_TYPES = Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.key, f.type]));

export const SURFACE_OPTIONS = ["Grass", "Turf", "Mixed", "Unknown"];

/* ---------------- Coach-facing presentation ---------------- */

const trimmed = (v) => {
  const t = (v ?? "").toString().trim();
  return t.length > 0 ? t : null;
};

/**
 * The one normalized address line, or null when there is no street address.
 *
 * Returns null rather than falling back to "City, ST": city and state already
 * render beneath the facility name, and repeating them there was the source of
 * the duplicated address in the drawer. 17 of 179 facilities have no street.
 */
export function formatFacilityAddress(f) {
  const street = trimmed(f?.street_address);
  if (!street) return null;

  const locality = [
    trimmed(f?.city),
    [trimmed(f?.state), trimmed(f?.zip)].filter(Boolean).join(" ") || null,
  ]
    .filter(Boolean)
    .join(", ");

  return locality ? `${street}, ${locality}` : street;
}

/**
 * Google Maps universal cross-platform URL, generated from the address.
 *
 * No API key, no billing, no Maps Platform terms obligation — this is a plain
 * URL scheme that opens the native maps app on iOS and Android.
 *
 * Deliberately does not read maps_link: that column is populated on 51 of 179
 * facilities, so depending on it left the action missing on 72% of records.
 * The column is retained and untouched pending the external-provider decision.
 */
export function facilityMapsUrl(f) {
  const query =
    formatFacilityAddress(f) ??
    [trimmed(f?.name), trimmed(f?.city), trimmed(f?.state)].filter(Boolean).join(", ");

  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Surface, only when it carries information.
 *
 * A whitelist rather than a blacklist: 106 of 179 facilities are "Mixed" and 41
 * are "Unknown", so 82% of the catalog says nothing. A whitelist keeps that
 * true if the enum gains values later.
 */
export function displayableSurface(surface) {
  return surface === "Grass" || surface === "Turf" ? surface : null;
}

/** Renders a stored value for display in the audit trail. */
export function displayValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (v === "true") return "Yes";
  if (v === "false") return "No";
  return String(v);
}

/** Normalizes a facility value to the text form stored in facility_edits. */
export function toStoredValue(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * US states and territories, keyed by the two-letter code that is stored.
 *
 * The CODE remains the stored and submitted value everywhere — address
 * verification compares `state` exactly, so changing what is persisted would
 * change Phase 3's consistency check. Full names are for display only.
 */
export const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", VI: "U.S. Virgin Islands", GU: "Guam", AS: "American Samoa",
  MP: "Northern Mariana Islands",
};

/** Options for a state selector, alphabetical by name. */
export const US_STATE_OPTIONS = Object.entries(US_STATES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Full state name for display, falling back to whatever is stored.
 *
 * An unrecognised or legacy value is shown as-is rather than blanked: the
 * coach's data is not hidden because it is not in our map.
 */
export function stateName(code) {
  const key = String(code ?? "").trim().toUpperCase();
  return US_STATES[key] ?? (code ? String(code).trim() : null);
}

/** "Sarasota, Florida" — display only; stored values are untouched. */
export function cityStateLong(f) {
  const city = String(f?.city ?? "").trim();
  const state = stateName(f?.state);
  return [city, state].filter(Boolean).join(", ") || null;
}
