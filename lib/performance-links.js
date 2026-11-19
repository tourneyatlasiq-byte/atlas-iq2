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

/**
 * The label for one game's link (2026-11-19). A game still being tracked says
 * "Open tracker" (you are going back to keep recording); a completed game says
 * "Review & Edit" (you are correcting what was recorded). A coach looking at a
 * past season keeps "View", because the database refuses their edits.
 *
 * `baseLabel` is seasonGameLinkLabel(); completion is the explicit coach action
 * on the game, never inferred from the score or the plate appearance count.
 */
export function gameLinkLabelFor(baseLabel, completed) {
  if (!baseLabel) return null;
  if (baseLabel === "View →") return baseLabel;
  return completed ? baseLabel : "Open tracker →";
}
