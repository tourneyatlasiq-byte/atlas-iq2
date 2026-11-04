"use server";

import { requireSeasonContext, canWrite } from "../context";
import { geocodePostalCode } from "../geocoding/geocodio";
import { lookupZipKey, pickZipMatch } from "../player-zip-rules";

/**
 * City and State for a ZIP, for the Player form. READ ONLY.
 *
 * Takes a ZIP and nothing else, so no player name, street address or team
 * information can reach Geocodio from this path. Writes nothing: the coach's
 * Save still goes through addRosterMember / updateRosterMember unchanged.
 *
 * Restricted to signed-in users who can edit the roster, which is everyone who
 * can see the Player form, so the billable lookup is not open to anyone else.
 *
 * Never throws. Every failure (missing key, vendor down, no context) is
 * { status: "unavailable" }, which the form shows as a quiet note; saving is
 * unaffected.
 *
 * Returns only { status, zip, city, state }.
 */
export async function lookupPlayerZip(zip) {
  try {
    const key = lookupZipKey(typeof zip === "string" ? zip : "");
    if (!key) return { status: "invalid" };

    const ctx = await requireSeasonContext();
    if (!canWrite(ctx.profile)) return { status: "unavailable" };

    const { ok, candidates } = await geocodePostalCode(key);
    if (!ok) return { status: "unavailable" };

    const match = pickZipMatch(candidates, key);
    if (!match) return { status: "no_match" };
    return { status: "match", zip: match.zip, city: match.city, state: match.state };
  } catch {
    return { status: "unavailable" };
  }
}
