import { createClient } from "../supabase/server";

/**
 * Reads for QAB lineup setup.
 *
 * The lineup is a batting order and nothing more — no positions, no innings,
 * no substitutions. It exists so plate appearances can be attributed to a
 * batter, and both future QAB entry paths (live phone tracking and
 * retrospective desktop entry) read the same order from the same table.
 *
 * Every query here runs under the caller's RLS. The QAB feature gate lives in
 * the policies on game_lineup_slots, so an organization without the flag reads
 * an empty lineup rather than an error — the page renders, the order is empty,
 * and saving is refused by the database. Nothing in this file re-checks the
 * flag; doing so would put the gate in two places that could disagree.
 */

/**
 * Which players may bat in this game.
 *
 * tournament_participants is the authoritative event roster: it is who
 * actually travelled, it includes pickups, and it carries the jersey numbers a
 * tracker uses to identify a batter at the plate.
 *
 * Not every tournament has one. When it is empty we fall back to the season
 * roster so the page is usable, and we say so — `source` is returned to the
 * caller precisely so the UI can tell the user which list they are looking at.
 * A silent fallback would let someone build a lineup from last season's roster
 * without noticing.
 */
async function eligiblePlayers(supabase, { tournamentId, seasonId }) {
  const { data: participants, error: pErr } = await supabase
    .from("tournament_participants")
    .select(
      `id, player_id, participation, jersey_number,
       player:players ( id, full_name, person_type, archived_at )`
    )
    .eq("tournament_id", tournamentId);

  if (pErr) throw new Error(`Could not load the tournament roster: ${pErr.message}`);

  const fromParticipants = (participants ?? [])
    .filter((p) => p.player && p.player.person_type === "player" && !p.player.archived_at)
    .map((p) => ({
      player_id: p.player_id,
      full_name: p.player.full_name,
      jersey_number: p.jersey_number,
      participation: p.participation,
    }));

  if (fromParticipants.length > 0) {
    return { source: "participants", players: sortPlayers(fromParticipants) };
  }

  const { data: rosterRows, error: rErr } = await supabase
    .from("team_season_players")
    .select(
      `id, player_id, jersey_number, is_active,
       player:players ( id, full_name, person_type, archived_at )`
    )
    .eq("season_id", seasonId);

  if (rErr) throw new Error(`Could not load the season roster: ${rErr.message}`);

  const fromRoster = (rosterRows ?? [])
    .filter(
      (r) =>
        r.is_active !== false &&
        r.player &&
        r.player.person_type === "player" &&
        !r.player.archived_at
    )
    .map((r) => ({
      player_id: r.player_id,
      full_name: r.player.full_name,
      jersey_number: r.jersey_number,
      participation: null,
    }));

  return { source: "season_roster", players: sortPlayers(fromRoster) };
}

/** Jersey number first when present, then name. Matches how a coach reads a sheet. */
function sortPlayers(list) {
  return [...list].sort((a, b) => {
    const an = a.jersey_number ?? Number.MAX_SAFE_INTEGER;
    const bn = b.jersey_number ?? Number.MAX_SAFE_INTEGER;
    return an - bn || (a.full_name ?? "").localeCompare(b.full_name ?? "");
  });
}

/**
 * Everything the lineup screen needs, in one call.
 *
 * Game context is loaded deliberately — opponent, date, time, type and
 * tournament name are shown at the top of the page so a coach entering four
 * completed games from a weekend cannot attribute a batting order to the wrong
 * one.
 */
export async function getLineupContext(gameId) {
  const supabase = createClient();

  const { data: game, error: gErr } = await supabase
    .from("games")
    .select(
      `id, organization_id, season_id, tournament_id, game_date, start_time,
       opponent_name, game_type, runs_for, runs_against, result,
       qab_completed_at,
       tournament:tournaments ( id, name, start_date, end_date )`
    )
    .eq("id", gameId)
    .maybeSingle();

  if (gErr) throw new Error(`Could not load the game: ${gErr.message}`);
  if (!game) return null;

  const { data: slots, error: sErr } = await supabase
    .from("game_lineup_slots")
    .select(
      `id, player_id, batting_order,
       player:players ( id, full_name, archived_at )`
    )
    .eq("game_id", gameId)
    .order("batting_order");

  if (sErr) throw new Error(`Could not load the lineup: ${sErr.message}`);

  const { source, players } = await eligiblePlayers(supabase, {
    tournamentId: game.tournament_id,
    seasonId: game.season_id,
  });

  // Jersey number and participation are TOURNAMENT-SPECIFIC display data,
  // resolved at read time from this tournament's participant rows. They are
  // never stored on game_lineup_slots and never written back to the player or
  // season-roster record. A pickup may wear #23 this weekend and a different
  // number next; identity is player_id and only player_id.
  const participantByPlayer = new Map(
    players.map((p) => [p.player_id, { jersey: p.jersey_number, participation: p.participation }])
  );

  const lineup = (slots ?? []).map((s) => {
    const meta = participantByPlayer.get(s.player_id);
    return {
      player_id: s.player_id,
      full_name: s.player?.full_name ?? "Unknown player",
      jersey_number: meta?.jersey ?? null,
      participation: meta?.participation ?? null,
      batting_order: s.batting_order,
      archived: Boolean(s.player?.archived_at),
    };
  });

  return { game, lineup, availablePlayers: players, playerSource: source };
}

/**
 * Games in this season that have a saved lineup, offered as copy sources.
 *
 * Replaces the previous "most recent earlier game" inference. That inference
 * tie-broke on game id, and because ids are random UUIDs, four games played on
 * one day resolved in an arbitrary order — a copy could pull from a game the
 * coach had not played yet. The coach now picks the source, so no ordering
 * rule has to be correct for the result to be right.
 *
 * Listed newest first for convenience only; nothing depends on the order.
 * start_time is included because a one-day tournament is exactly the case the
 * old inference got wrong, and it is the only field that distinguishes those
 * games to a human.
 */
export async function lineupCopySources(gameId) {
  const supabase = createClient();

  const { data: game } = await supabase
    .from("games")
    .select("id, season_id")
    .eq("id", gameId)
    .maybeSingle();

  if (!game) return [];

  const { data: candidates } = await supabase
    .from("games")
    .select(
      `id, game_date, start_time, opponent_name, game_type,
       tournament:tournaments ( id, name ),
       lineup:game_lineup_slots ( id )`
    )
    .eq("season_id", game.season_id)
    .neq("id", gameId)
    .order("game_date", { ascending: false })
    .order("start_time", { ascending: false, nullsFirst: false });

  return (candidates ?? [])
    .filter((g) => (g.lineup ?? []).length > 0)
    .map((g) => ({
      id: g.id,
      game_date: g.game_date,
      start_time: g.start_time,
      opponent_name: g.opponent_name,
      game_type: g.game_type,
      tournament_name: g.tournament?.name ?? null,
      batters: (g.lineup ?? []).length,
    }));
}
