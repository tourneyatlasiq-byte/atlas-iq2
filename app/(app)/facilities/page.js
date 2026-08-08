import { getContext, canWrite } from "../../../lib/context";
import { listFacilities } from "../../../lib/queries/facilities";
import { isExternalSearchEnabled } from "../../../lib/places/provider";
import { FacilitiesClient } from "../../../components/FacilitiesClient";

export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
  const { profile, organization } = await getContext();

  const facilities = await listFacilities(organization.id);

  return (
    <FacilitiesClient
      facilities={facilities}
      organizationId={organization.id}
      canWrite={canWrite(profile)}
      isAdmin={profile?.role === "owner" || profile?.role === "admin"}
      externalEnabled={isExternalSearchEnabled()}
    />
  );
}
