import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, canWrite } from "../../../../../../../lib/context";
import { getLineupContext, lineupCopySources } from "../../../../../../../lib/queries/lineup";
import { LineupClient } from "../../../../../../../components/LineupClient";

export const dynamic = "force-dynamic";

/**
 * Batting order for one game.
 *
 * A full screen rather than a section of the tournament drawer: the editor
 * needs an available-players list and an ordered list side by side on desktop,
 * and enough vertical room on a phone that neither needs its own scroll
 * region. It stays inside the tournament path so the game keeps its context —
 * a game has no meaning outside its tournament.
 *
 * This order is read later by both QAB entry paths, live and retrospective.
 * Nothing about it assumes which one.
 */
export default async function LineupPage({ params }) {
  const { profile } = await getContext();
  const ctx = await getLineupContext(params.gameId);

  if (!ctx) notFound();
  if (ctx.game.tournament_id !== params.tournamentId) notFound();

  const copySources = await lineupCopySources(params.gameId);

  return (
    <div className="page">
      <div className="page-head">
        <Link href="/tournaments" className="back-link">
          ← Tournaments
        </Link>
      </div>

      <LineupClient
        game={ctx.game}
        initialLineup={ctx.lineup}
        availablePlayers={ctx.availablePlayers}
        playerSource={ctx.playerSource}
        copySources={copySources}
        canWrite={canWrite(profile)}
      />
    </div>
  );
}
