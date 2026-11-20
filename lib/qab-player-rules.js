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

/**
 * The players a coach can choose from for the individual report (Reports entry
 * and the in-report player switch). It mirrors the report's own eligibility
 * rule exactly, so every choice opens a report and nothing the report would
 * refuse is offered: a player is eligible with a roster row on this team's
 * season OR a recorded (non-voided) plate appearance in it.
 *
 *   active   roster row, is_active, or any active row on this team
 *   inactive roster row(s), none active
 *   pickup   plate appearances but no roster row on this team
 *
 * Roster rows for staff (person_type other than "player") are not offered unless
 * they have recorded at-bats. Names sort A to Z with the id as tie-breaker so
 * the order is stable. Each choice says how many plate appearances the player
 * has, so an empty history is visible before opening.
 *
 * rosterRows: [{ player_id, team_id, is_active, player: { id, full_name, person_type } }]
 * paRows:     [{ player_id, player: { id, full_name } }]   (non-voided, this season)
 */
export function groupPlayerChoices({ rosterRows = [], paRows = [], teamId = null } = {}) {
  const pa = new Map();
  const names = new Map();
  for (const r of paRows ?? []) {
    if (!r?.player_id) continue;
    pa.set(r.player_id, (pa.get(r.player_id) ?? 0) + 1);
    if (r.player?.full_name) names.set(r.player_id, r.player.full_name);
  }
  const team = (rosterRows ?? []).filter((r) => r?.player_id && (!teamId || r.team_id === teamId));
  const activity = activityByPlayer(team, null);
  const isPlayer = new Map();
  for (const r of team) {
    if (r.player?.full_name) names.set(r.player_id, r.player.full_name);
    isPlayer.set(r.player_id, r.player?.person_type === "player" || r.player?.person_type == null);
  }

  const out = { active: [], inactive: [], pickup: [] };
  const ids = new Set([...activity.keys(), ...pa.keys()]);
  for (const id of ids) {
    const count = pa.get(id) ?? 0;
    const onRoster = activity.has(id);
    if (onRoster && !isPlayer.get(id) && count === 0) continue; // staff without at-bats
    const group = !onRoster ? "pickup" : activity.get(id) ? "active" : "inactive";
    out[group].push({ id, name: names.get(id) ?? "Unknown player", pa: count });
  }
  const cmp = (a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id));
  for (const k of Object.keys(out)) out[k].sort(cmp);
  return out;
}

/**
 * Search for the player picker. Case and accents are ignored, every word typed
 * must appear somewhere in the name ("lane av" finds "Ava Lane"), and the
 * three groups and their order are kept so a match never loses its context.
 * Nothing typed (or only spaces) returns everyone.
 */
export function filterPlayerChoices(choices, query) {
  const norm = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = norm(query).split(/\s+/).filter(Boolean);
  const out = { active: [], inactive: [], pickup: [] };
  for (const k of Object.keys(out)) {
    out[k] = (choices?.[k] ?? []).filter((c) => {
      const n = norm(c.name);
      return words.every((w) => n.includes(w));
    });
  }
  return out;
}

/** The choice label: name, plus the at-bat count or "no at-bats yet". */
export function playerChoiceLabel(c) {
  return c.pa > 0 ? `${c.name} \u00b7 ${c.pa} PA` : `${c.name} \u00b7 no at-bats yet`;
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
