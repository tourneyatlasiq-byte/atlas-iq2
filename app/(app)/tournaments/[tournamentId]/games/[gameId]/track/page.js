import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, canWrite } from "../../../../../../../lib/context";
import { getLineupContext } from "../../../../../../../lib/queries/lineup";
import { listGamePlateAppearances } from "../../../../../../../lib/queries/plate-appearances";
import { TrackerClient } from "../../../../../../../components/TrackerClient";

export const dynamic = "force-dynamic";

/**
 * Live QAB tracking for one game.
 *
 * Sits beside the lineup route so the whole flow — game, lineup, track — stays
 * inside the tournament path. Server-rendered rows seed the client; from then
 * on the tracker owns its state and writes through the offline queue.
 *
 * If QAB is disabled for the organization, RLS returns no lineup and no plate
 * appearances, so this renders the "no batting order" state and every write is
 * refused by the database. The gate is not re-checked here.
 */
export default async function TrackPage({ params }) {
  const { profile } = await getContext();
  const ctx = await getLineupContext(params.gameId);

  if (!ctx) notFound();
  if (ctx.game.tournament_id !== params.tournamentId) notFound();

  const rows = await listGamePlateAppearances(params.gameId);

  const seeded = rows.map((r) => ({
    ...r,
    localSeq: new Date(r.created_at ?? 0).getTime(),
  }));

  return (
    <div className="page">
      <div className="page-head">
        <Link
          href={`/tournaments/${params.tournamentId}/games/${params.gameId}/lineup`}
          className="back-link"
        >
          ← Lineup
        </Link>
      </div>

      <TrackerClient
        game={ctx.game}
        lineup={ctx.lineup}
        initialRows={seeded}
        canWrite={canWrite(profile)}
      />
    </div>
  );
}
