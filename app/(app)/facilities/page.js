import { getContext, canWrite } from "../../../lib/context";
import { listFacilities, listSeasonTournaments } from "../../../lib/queries/facilities";
import { isExternalSearchEnabled } from "../../../lib/places/provider";
import { documentsByEntity, documentTargets } from "../../../lib/queries/documents";
import { utcDateIso } from "../../../lib/local-date";
import { FacilitiesClient } from "../../../components/FacilitiesClient";

export const dynamic = "force-dynamic";

export default async function FacilitiesPage({ searchParams }) {
  const { profile, organization, season } = await getContext();

  // Field maps and site paperwork belong with the facility they describe.
  // documents.facility_id already existed; nothing consumed it.
  const [facilities, facilityDocs, targets, tournaments, tournamentDocs, sp] = await Promise.all([
    listFacilities(organization.id),
    documentsByEntity("facility_id"),
    documentTargets(season?.id, organization.id),
    listSeasonTournaments(season?.id),
    documentsByEntity("tournament_id"),
    searchParams,
  ]);
  // Search and filters live in the URL, so Back from a place or a tournament
  // returns to the same results (and the browser restores the scroll).
  const pick = (k) => (typeof sp?.[k] === "string" ? sp[k] : undefined);

  return (
    <FacilitiesClient
      facilities={facilities}
      facilityDocs={facilityDocs}
      documentTargets={targets}
      seasonName={season?.name}
      organizationId={organization.id}
      canWrite={canWrite(profile)}
      isAdmin={profile?.role === "owner" || profile?.role === "admin"}
      externalEnabled={isExternalSearchEnabled()}
      tournaments={tournaments}
      tournamentDocs={Object.fromEntries(tournamentDocs)}
      serverToday={utcDateIso()}
      initialFilters={{
        q: pick("q"), view: pick("view"), type: pick("type"), st: pick("st"),
        county: pick("county"), surface: pick("surface"), amenity: pick("amenity"),
      }}
      forceAllView={sp?.view === "all"}
      autoOpen={sp?.add === "1"}
    />
  );
}
