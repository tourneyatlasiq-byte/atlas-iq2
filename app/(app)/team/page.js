import { getContext, canWrite } from "../../../lib/context";
import {
  listSeasonRoster,
  listAssignablePlayers,
  deriveSummary,
} from "../../../lib/queries/roster";
import { documentsByEntity, documentTargets } from "../../../lib/queries/documents";
import { createClient } from "../../../lib/supabase/server";
import { pickupsForSeason } from "../../../lib/queries/participants";
import { RosterClient } from "../../../components/RosterClient";

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }) {
  const { profile, organization, season, seasonPhase } = await getContext();

  if (!season) {
    return (
      <div className="card">
        <div className="empty">
          <h3>No season yet</h3>
          <p>This team needs a season before a roster can be built.</p>
        </div>
      </div>
    );
  }

  const [rows, assignable, docsByPlayer, targets] = await Promise.all([
    listSeasonRoster(season.id),
    listAssignablePlayers(organization.id, season.id),
    documentsByEntity("player_id"),
    documentTargets(season.id, organization.id),
  ]);

  // Documents are views of the same canonical records shown in Files, attached
  // by player_id. Nothing is copied.
  const withDocs = rows.map((r) => ({
    ...r,
    documents: docsByPlayer.get(r.player?.id) ?? [],
  }));

  const { data: payRows } = await createClient()
    .from("player_payments")
    .select("id, player_id")
    .eq("season_id", season.id);

  const paymentIdByPlayer = Object.fromEntries(
    (payRows ?? []).filter((r) => r.player_id).map((r) => [r.player_id, r.id])
  );

  return (
    <RosterClient
      rows={withDocs}
      assignable={assignable}
      summary={deriveSummary(rows)}
      canWrite={canWrite(profile)}
      isAdmin={profile?.role === "owner" || profile?.role === "admin"}
      documentTargets={targets}
      seasonName={season.name}
      seasonPhase={seasonPhase}
      paymentIdByPlayer={paymentIdByPlayer}
      pickups={await pickupsForSeason(season.id)}
      autoOpen={(await searchParams)?.add === "person"}
    />
  );
}
