"use server";

import { requireSeasonContext, canWrite } from "../context";
import { searchPlaces, getPlaceDetails, isExternalSearchEnabled } from "../places/provider";

/**
 * External place search, wrapped as server actions.
 *
 * Deliberately server-side: whichever provider is chosen will need an API key,
 * and keys must not reach the browser. Routing through here means enabling a
 * provider requires no client change.
 *
 * OPEN ITEM: External Places provider pending licensing confirmation for
 * permanent multi-tenant canonical Facility storage. Until one is configured
 * these return an unavailable result and the UI falls back to manual entry.
 */

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow adding facilities.");
  return ctx;
}

export async function searchExternalPlaces(formData) {
  try {
    await guard();

    if (!isExternalSearchEnabled()) {
      return { ok: false, unavailable: true, results: [] };
    }

    const query = (formData.get("query") ?? "").toString().trim();
    if (!query) return { ok: true, results: [] };

    return { ok: true, results: await searchPlaces(query, { limit: 8 }) };
  } catch (e) {
    return { ok: false, error: e.message, results: [] };
  }
}

export async function fetchExternalPlaceDetails(formData) {
  try {
    await guard();

    if (!isExternalSearchEnabled()) {
      return { ok: false, unavailable: true, details: null };
    }

    const externalId = (formData.get("external_id") ?? "").toString().trim();
    if (!externalId) return { ok: false, error: "Missing place reference.", details: null };

    const details = await getPlaceDetails(externalId);
    if (!details) return { ok: false, error: "That place could not be loaded.", details: null };

    return { ok: true, details };
  } catch (e) {
    return { ok: false, error: e.message, details: null };
  }
}
