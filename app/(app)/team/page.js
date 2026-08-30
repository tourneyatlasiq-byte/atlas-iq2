import { getContext, canWrite } from "../../../lib/context";
import {
  listSeasonRoster,
  listAssignablePlayers,
  organizationPlayerCount,
  deriveSummary,
} from "../../../lib/queries/roster";
import { documentsByEntity, documentTargets } from "../../../lib/queries/documents";
import { createClient } from "../../../lib/supabase/server";
import { pickupsForSeason } from "../../../lib/queries/participants";
import { listContacts, recruitingByPlayer } from "../../../lib/queries/contacts";
import { RosterClient } from "../../../components/RosterClient";
import { listMatchCandidates } from "../../../lib/queries/match-candidates";

import { SetupNext, setupState } from "../../../components/SetupNext";

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }) {
  const { profile, organization, team, season, seasonPhase } = await getContext();

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

  const [rows, matchCandidates, assignable, docsByPlayer, targets] = await Promise.all([
    listSeasonRoster(season.id),
    // Organization-wide, so the import preview evaluates the same population
    // the server will. A player who is in the organization but not on this
    // season roster is otherwise invisible to the browser and visible to the
    // server, and the preview says Create for a row the server will match.
    listMatchCandidates(),
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

  const setup = await setupState(createClient(), { organization, team, season, profile });

  return (
    <>
      <SetupNext steps={setup.steps} hidden={setup.hidden} currentStepId="roster" />
    <RosterClient
      rows={withDocs}
      assignable={assignable}
      orgPlayerCount={await organizationPlayerCount(organization.id)}
      summary={deriveSummary(rows)}
      canWrite={canWrite(profile)}
      isAdmin={profile?.role === "owner" || profile?.role === "admin"}
      documentTargets={targets}
      matchCandidates={matchCandidates}
      seasonName={season.name}
      teamName={team?.name}
      seasonPhase={seasonPhase}
      paymentIdByPlayer={paymentIdByPlayer}
      pickups={await pickupsForSeason(season.id)}
      contacts={await listContacts(organization.id)}
      recruiting={await recruitingByPlayer(organization.id)}
      autoOpen={(await searchParams)?.add === "person"}
    />
    </>
  );
}
