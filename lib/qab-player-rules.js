import { qabPercent, legacyReasonNote } from "./qab-rules";
import { activityByPlayer } from "./performance-groups";
import { gameHref } from "./game-flow-rules";
import { isGameWithinTournament, formatDateRange, formatDayLabel } from "./schedule-rules";

/**
 * Rules for the individual player QAB report (RPT-002, 2026-11).
 *
 * PURE, no database. Everything here is built from the payload that
 * getSeasonPerformance already derived for one scope. No QAB figure is
 * recalculated: the player's totals, reason counts and per-game counts are the
 * values the Performance screen shows for the same scope, which is the whole
 * point of the reconciliation guarantee.
 *
 * ONE-PLAYER ALLOWLIST. The returned object is constructed field by field. It
 * holds the one player's own numbers and nothing else: no teammate, no player
 * id, no score, no win/loss/tie, no lineup, no team comparison. Opponent names
 * and dates appear because they identify the player's own games.
 *
 * COACH-FACING, by decision (2026-11). It is not a parent report and is not
 * opened to parent logins; the page checks that before calling this.
 */

const NO_TOURNAMENT = "Games not in a tournament";

/** 'active' | 'inactive' | 'pickup'. No roster row on this team means a pickup. */
export function playerRosterStatus(rosterRows, teamId, playerId) {
  const activity = activityByPlayer(rosterRows, teamId);
  if (!activity.has(playerId)) return "pickup";
  return activity.get(playerId) ? "active" : "inactive";
}

/** The quiet tag beside the team line. Active players carry none. */
export function statusTag(status) {
  if (status === "pickup") return "Pickup player";
  if (status === "inactive") return "Inactive";
  return null;
}

/**
 * Distinct tournament ids from this player's own non-voided plate appearances
 * (rows shaped { game: { tournament_id } }). Drives the screen-only scope
 * control, so a coach is never offered a tournament that would only say "no
 * plate appearances". Games with no tournament add nothing.
 */
export function tournamentIdsFromRows(rows) {
  const seen = new Set();
  for (const r of rows ?? []) {
    const id = r?.game?.tournament_id;
    if (id) seen.add(id);
  }
  return [...seen];
}

/**
 * A string safe inside a CSS content: "..." value. Used for the running print
 * header, which CSS cannot read from the page. Quotes, backslashes and line
 * breaks are escaped so a name can never end the string or the rule.
 */
export function cssString(value) {
  return String(value ?? "")
    .replace(/[\\"]/g, (c) => `\\${c}`)
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[<>]/g, "");
}

/** The PDF filename and page title: "Team - QAB Player Report - Player - Season". */
export function playerReportTitle({ team, player, season, tournament = null }) {
  return [team, "QAB Player Report", player, tournament, season].filter(Boolean).join(" - ");
}

function groupGames(games, scope) {
  if (scope.kind === "tournament") {
    return games.length ? [{ title: scope.tournament.name, tournamentId: scope.tournament.id ?? null, games }] : [];
  }
  const order = [];
  const byKey = new Map();
  for (const g of games) {
    const key = g.tournamentId ?? "none";
    if (!byKey.has(key)) {
      byKey.set(key, { title: g.tournament ?? NO_TOURNAMENT, tournamentId: g.tournamentId ?? null, games: [] });
      order.push(key);
    }
    byKey.get(key).games.push(g);
  }
  // Tournaments by their first game, games outside any tournament last.
  return order.map((k) => byKey.get(k)).sort((a, b) => (a.tournamentId == null) - (b.tournamentId == null));
}

/**
 * The report payload for one player in one scope.
 *
 * scoped:     getSeasonPerformance(seasonId, { tournamentId? }) for that scope
 * name:       the player's name (the page reads it, so an empty history still has one)
 * status:     playerRosterStatus(...)
 * tournament: { id?, name, start_date, end_date } when the scope is a tournament
 */
export function buildQabPlayerReport({ scoped, playerId, name, status = "active", identity = {}, tournament = null, generatedAt = null }) {
  const p = (scoped?.players ?? []).find((x) => x.playerId === playerId) ?? null;
  const history = Array.isArray(p?.history) ? p.history : [];
  const gameById = new Map((scoped?.games ?? []).map((g) => [g.gameId, g]));

  const qab = p?.qab ?? 0;
  const pa = p?.pa ?? 0;
  const scope = tournament
    ? { kind: "tournament", tournament: { id: tournament.id ?? null, name: tournament.name, dates: formatDateRange(tournament.start_date, tournament.end_date) } }
    : { kind: "season" };

  const games = history.map((h) => {
    const g = gameById.get(h.gameId) ?? {};
    return {
      id: h.gameId,
      dateISO: g.gameDate ?? h.gameDate ?? null,
      day: formatDayLabel(g.gameDate ?? h.gameDate ?? null),
      time: g.startTime ?? null,
      opponent: h.opponent ?? g.opponent ?? null,
      tournament: g.tournament ?? null,
      tournamentId: g.tournamentId ?? null,
      qab: h.qab,
      pa: h.pa,
      qabPct: qabPercent(h.qab, h.pa),
      // Tournament scope only: linked to the tournament but dated outside its
      // dates. It stays in the figures because of the link; the printed report
      // says so beside the game.
      outside: Boolean(
        tournament && (g.gameDate ?? h.gameDate) && !isGameWithinTournament(g.gameDate ?? h.gameDate, tournament.start_date, tournament.end_date)
      ),
    };
  });

  const reasons = (p?.reasons ?? [])
    .filter((r) => r.count > 0)
    .map((r) => ({ label: r.label, count: r.count, percent: qab > 0 ? Math.round((r.count / qab) * 1000) / 10 : null }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const reasonsCited = reasons.reduce((n, r) => n + r.count, 0);

  const notes = [...legacyReasonNote(reasonsCited, qab)];
  if (tournament) {
    const outside = games.filter((g) => g.outside);
    if (outside.length > 0) {
      notes.push({
        action: false,
        title: "Game date to review",
        // One normal link to the first such game's page, where its date is corrected.
        ...(tournament.id ? { href: gameHref(tournament.id, outside[0].id, "track"), linkLabel: "Review game \u2192" } : {}),
        message:
          `${outside.map((g) => formatDayLabel(g.dateISO)).join(", ")} ` +
          `${outside.length === 1 ? "is" : "are"} linked to this tournament but dated outside ` +
          `${formatDateRange(tournament.start_date, tournament.end_date) ?? "its dates"}. ` +
          `${outside.length === 1 ? "It is" : "They are"} included here because of that link. ` +
          "Review the game date in Tournaments if it isn't right.",
      });
    }
  }

  return {
    generatedAt,
    organization: identity.organization ?? { name: null, logoUrl: null },
    team: identity.team ?? { name: null },
    season: identity.season ?? { name: null },
    scope,
    player: { name, status, tag: statusTag(status) },
    empty: history.length === 0,
    summary: {
      qabPct: pa > 0 ? qabPercent(qab, pa) : null,
      qab,
      pa,
      games: history.length,
    },
    reasons,
    games,
    groups: groupGames(games, scope),
    notes,
  };
}
