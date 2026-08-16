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

export const EDITABLE_FIELDS = [
  { key: "name", label: "Facility name", type: "text" },
  { key: "street_address", label: "Street address", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "zip", label: "ZIP", type: "text" },
  { key: "county", label: "County", type: "text" },
  { key: "latitude", label: "Latitude", type: "number" },
  { key: "longitude", label: "Longitude", type: "number" },
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
