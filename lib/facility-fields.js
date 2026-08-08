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
