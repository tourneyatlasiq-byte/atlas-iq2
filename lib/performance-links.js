/**
 * The label on each season game's link to its tracker (2026-11).
 *
 * A finished season takes no new records, and only an owner or admin may
 * correct existing ones (enforce_season_write_policy). So:
 *   current / future season          → "Review & Edit →" for everyone
 *   past season, owner or admin      → "Review & Edit →" (historical correction)
 *   past season, anyone else         → "View →" (the database refuses their edits)
 *
 * Wording only. The database decides what can actually be saved.
 */
export function seasonGameLinkLabel(seasonPhase, profile) {
  const admin = profile?.role === "owner" || profile?.role === "admin";
  return seasonPhase === "past" && !admin ? "View →" : "Review & Edit →";
}
