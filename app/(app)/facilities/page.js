import { getContext, canWrite } from "../../../lib/context";
import { listFacilities } from "../../../lib/queries/facilities";
import { isExternalSearchEnabled } from "../../../lib/places/provider";
import { documentsByEntity, documentTargets } from "../../../lib/queries/documents";
import { FacilitiesClient } from "../../../components/FacilitiesClient";

export const dynamic = "force-dynamic";

export default async function FacilitiesPage({ searchParams }) {
  const { profile, organization, season } = await getContext();

  // Field maps and site paperwork belong with the facility they describe.
  // documents.facility_id already existed; nothing consumed it.
  const [facilities, facilityDocs, targets] = await Promise.all([
    listFacilities(organization.id),
    documentsByEntity("facility_id"),
    documentTargets(season?.id, organization.id),
  ]);

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
      forceAllView={(await searchParams)?.view === "all"}
      autoOpen={(await searchParams)?.add === "1"}
    />
  );
}
