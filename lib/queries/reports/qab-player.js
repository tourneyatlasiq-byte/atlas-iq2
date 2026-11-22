import { createClient } from "../../supabase/server";
import { getSeasonPerformance } from "../performance";
import { reportIdentity } from "./qab-performance";
import {
  buildQabPlayerReport,
  playerRosterStatus,
  tournamentIdsFromRows,
} from "../../qab-player-rules";
import { formatDateRange } from "../../schedule-rules";

/**
 * Individual player QAB report (RPT-002, 2026-11). COACH-FACING.
 *
 * One scoped read of getSeasonPerformance, the same derivation the Performance
 * screen uses, so the report cannot drift from it. The payload is then built
 * by hand in buildQabPlayerReport (lib/qab-player-rules.js): one player, no
 * teammate data, no scores, no results, no team comparison.
 *
 * Season scope also carries the team's game dates and opponents (games this
 * player did not bat in appear as "no PA recorded"), with her own figures only.
 * See the EXPANDED SCOPE note in lib/qab-player-rules.js.
 *
 * This is NOT the team report's payload filtered down. The team payload has
 * no player key by design; this module builds its own one-player allowlist.
 * It is also not parent-safe: the route refuses parent logins before calling.
 *
 * Returns:
 *   { ok: true, report, tournaments }   tournaments = where this player batted
 *   { ok: false, reason: "player" }     unknown, or not part of this season
 *   { ok: false, reason: "tournament" } not a tournament of this season
 * RLS bounds every read; a foreign id reads nothing and is "not found".
 */
export async function qabPlayerReport(seasonId, playerId, { tournamentId = null } = {}) {
  if (!seasonId) throw new Error("qabPlayerReport requires a seasonId.");
  if (!playerId) return { ok: false, reason: "player" };

  const supabase = createClient();

  const { data: player } = await supabase
    .from("players")
    .select("id, full_name")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) return { ok: false, reason: "player" };

  // The player's own tracked games in this season: relatedness check and the
  // tournaments offered in the screen-only control. Voided rows never count.
  const { data: paRows, error: paErr } = await supabase
    .from("plate_appearances")
    .select("game:games ( tournament_id )")
    .eq("season_id", seasonId)
    .eq("player_id", playerId)
    .is("voided_at", null);
  if (paErr) throw new Error(`Could not load this player's tracked games: ${paErr.message}`);

  const { data: seasonRow } = await supabase.from("seasons").select("team_id").eq("id", seasonId).maybeSingle();
  const { data: rosterRows, error: rErr } = await supabase
    .from("team_season_players")
    .select("player_id, team_id, is_active")
    .eq("season_id", seasonId)
    .eq("player_id", playerId);
  if (rErr) throw new Error(`Could not load roster status: ${rErr.message}`);

  // Neither a roster row nor a tracked plate appearance: not this season's player.
  if ((paRows ?? []).length === 0 && (rosterRows ?? []).length === 0) return { ok: false, reason: "player" };

  const status = playerRosterStatus(rosterRows, seasonRow?.team_id ?? null, playerId);

  let tournament = null;
  if (tournamentId) {
    const { data: t } = await supabase
      .from("tournaments")
      .select("id, name, start_date, end_date")
      .eq("id", tournamentId)
      .eq("season_id", seasonId)
      .maybeSingle();
    if (!t) return { ok: false, reason: "tournament" };
    tournament = t;
  }

  const scoped = await getSeasonPerformance(seasonId, tournamentId ? { tournamentId } : {});
  const identity = await reportIdentity(seasonId);

  const report = buildQabPlayerReport({
    scoped,
    playerId,
    name: player.full_name ?? "Unknown player",
    status,
    tournament,
    generatedAt: new Date().toISOString(),
    identity: {
      organization: {
        name: identity?.team?.organization?.name ?? null,
        logoUrl: identity?.team?.organization?.logo_url ?? null,
      },
      team: { name: identity?.team?.name ?? null },
      season: { name: identity?.name ?? null },
    },
  });

  // Screen-only scope options: only tournaments where this player batted,
  // most recent first, plus the one being viewed so a link never loses it.
  const ids = tournamentIdsFromRows(paRows);
  const wanted = [...new Set([...ids, ...(tournamentId ? [tournamentId] : [])])];
  let tournaments = [];
  if (wanted.length > 0) {
    const { data: rows, error: tErr } = await supabase
      .from("tournaments")
      .select("id, name, start_date, end_date")
      .eq("season_id", seasonId)
      .in("id", wanted);
    if (tErr) throw new Error(`Could not load tournaments: ${tErr.message}`);
    tournaments = (rows ?? [])
      .sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? "") || (a.name ?? "").localeCompare(b.name ?? ""))
      .map((t) => ({ id: t.id, name: t.name, dates: formatDateRange(t.start_date, t.end_date) }));
  }

  return { ok: true, report, tournaments };
}
