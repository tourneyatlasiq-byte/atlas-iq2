import { createClient } from "../../supabase/server";
import { getSeasonPerformance } from "../performance";

/**
 * Payload for the coach-facing Team/Season QAB Performance report.
 *
 * ALLOWLIST, NOT A FILTER. Every field is constructed by hand from the values
 * getSeasonPerformance already derived. No QAB figure is recalculated here —
 * the report must reconcile to the Performance screen, and the only way to
 * guarantee that is to have one derivation.
 *
 * ARCHITECTURAL BOUNDARY — read before extending.
 * This payload is COACH-FACING and contains the whole roster. It must never
 * become the basis of the future parent-facing Individual Player report by
 * being filtered down to one player. To make that structurally hard rather
 * than merely discouraged, player rows carry NO playerId: there is no key to
 * filter on. A player report needs its own query with its own parent-safe
 * allowlist containing exactly one player and no teammate data.
 *
 * Deliberately absent:
 *   - playerId, and every per-player game history, trend and recent-form field
 *   - any wins-vs-losses or outcome-group aggregate. The investigation found
 *     Armor Elite and Northgate point in OPPOSITE directions on one loss
 *     each, so the statistic is not merely unsupported, it is misleading.
 *     Result appears beside a game as context and nowhere else.
 *   - lineup slots, batting orders, plate-appearance ids, tournament ids
 *   - runs_for, runs_against, scores
 */
export async function qabPerformanceReport(seasonId) {
  if (!seasonId) throw new Error("qabPerformanceReport requires a seasonId.");

  const season = await getSeasonPerformance(seasonId);
  if (!season) return null;

  /**
   * Identity is fetched here rather than added to getSeasonPerformance, which
   * is shared with the Performance screen and does not need it. A report
   * needing a header is not a reason to widen a derivation used elsewhere.
   */
  const supabase = createClient();
  const { data: identity } = await supabase
    .from("seasons")
    .select("name, team:teams ( name, organization:organizations ( name, logo_url ) )")
    .eq("id", seasonId)
    .maybeSingle();

  /**
   * Reason share of all reasons cited — not of quality at-bats.
   *
   * One plate appearance can cite several reasons, so these counts total more
   * than the QAB count and must never be presented as a share of QABs. The
   * denominator is reasonsCited, which is what the existing derivation totals.
   * Zero-count reasons are dropped rather than printed as empty bars.
   */
  const reasonsCited = season.reasonsCited ?? 0;
  const reasons = (season.reasons ?? [])
    .filter((r) => r.count > 0)
    .map((r) => ({
      label: r.label,
      count: r.count,
      percent: reasonsCited > 0 ? Math.round((r.count / reasonsCited) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    generatedAt: new Date().toISOString(),

    organization: {
      name: identity?.team?.organization?.name ?? null,
      logoUrl: identity?.team?.organization?.logo_url ?? null,
    },
    team: { name: identity?.team?.name ?? null },
    season: { name: identity?.name ?? null },

    // Team summary. Exactly the derived values, not re-derived.
    summary: {
      qabPct: season.team.qabPct,
      qab: season.team.qab,
      pa: season.team.pa,
      games: season.team.games,
      players: season.team.players,
    },

    /**
     * Chronological, using the ordering the derivation already applied:
     * game date, then start time with nulls last, then id. Result is context
     * only and may legitimately be absent.
     */
    games: (season.games ?? []).map((g) => ({
      id: g.gameId,
      date: g.gameDate,
      opponent: g.opponent,
      result: g.result ?? null,
      qab: g.qab,
      pa: g.pa,
      qabPct: g.qabPct,
    })),

    reasons,
    reasonsCited,

    /**
     * Every tracked player, with the percentage they actually recorded.
     *
     * No minimum-PA threshold, no suppression, no qualified/unqualified split.
     * PA sits beside QAB% so a coach reads the sample size for herself — that
     * is a better answer than the product deciding a real figure is unworthy
     * of display.
     *
     * Sorted QAB% descending, then PA descending, then name, so the order is
     * deterministic. It is a summary, not a ranking.
     */
    players: (season.players ?? [])
      .map((p) => ({ name: p.name, qab: p.qab, pa: p.pa, qabPct: p.qabPct }))
      .sort(
        (a, b) =>
          (b.qabPct ?? -1) - (a.qabPct ?? -1) ||
          b.pa - a.pa ||
          a.name.localeCompare(b.name)
      ),
  };
}
