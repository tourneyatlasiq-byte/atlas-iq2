/**
 * External places provider interface.
 *
 * OPEN ITEM: External Places provider pending licensing confirmation for
 * permanent multi-tenant canonical Facility storage.
 *
 * Google's terms permit storing place_id indefinitely but prohibit persisting
 * name and address, and cap coordinate caching at 30 days — which is
 * incompatible with a canonical shared Facility record. Mapbox's Permanent
 * Geocoding tier does permit indefinite storage, but its "no distribution or
 * sublicense" wording needs confirming against multi-tenant reads before we
 * commit.
 *
 * Nothing below names a provider. Facility records, components and business
 * logic depend only on this shape, so plugging one in later is an
 * implementation swap with no schema or UI change.
 *
 * A provider implements:
 *
 *   searchPlaces(query, { near, limit, signal })  -> PlaceSuggestion[]
 *   getPlaceDetails(externalId)                   -> PlaceDetails
 *
 * PlaceSuggestion — enough to render a picker row:
 *   { externalId, externalSource, name, description }
 *
 * PlaceDetails — everything needed to create a canonical Facility:
 *   { externalId, externalSource, name, streetAddress, city, state, zip,
 *     latitude, longitude, website }
 *
 * The field names are deliberately provider-neutral. Adapters translate from
 * whatever their provider returns; nothing downstream sees provider shapes.
 */

/** True once a provider is configured. Drives whether the UI offers the step. */
export function isExternalSearchEnabled() {
  return getProvider() !== null;
}

/**
 * Returns the active provider, or null when none is configured.
 *
 * When a provider is approved, import its adapter and return it here. That is
 * the only line that needs to change.
 */
export function getProvider() {
  return null;
}

/**
 * Searches external places. Returns an empty list while no provider is
 * configured, so callers never need to branch on availability.
 */
export async function searchPlaces(query, options = {}) {
  const provider = getProvider();
  if (!provider || !query?.trim()) return [];
  return provider.searchPlaces(query.trim(), options);
}

/** Full detail for one external place, or null when unavailable. */
export async function getPlaceDetails(externalId) {
  const provider = getProvider();
  if (!provider || !externalId) return null;
  return provider.getPlaceDetails(externalId);
}

/**
 * Maps provider-neutral details onto the Facility column names.
 *
 * The only place external shapes meet our schema. An adapter returning the
 * documented PlaceDetails shape needs no changes here.
 */
export function placeDetailsToFacility(details) {
  if (!details) return null;
  return {
    name: details.name ?? "",
    street_address: details.streetAddress ?? "",
    city: details.city ?? "",
    state: details.state ?? "",
    zip: details.zip ?? "",
    latitude: details.latitude ?? "",
    longitude: details.longitude ?? "",
    website: details.website ?? "",
    external_place_id: details.externalId ?? "",
    external_source: details.externalSource ?? "",
  };
}
