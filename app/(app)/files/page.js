import { getContext, canWrite } from "../../../lib/context";
import { listDocuments, documentTargets, documentSummary } from "../../../lib/queries/documents";
import { FilesClient } from "../../../components/FilesClient";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const { profile, organization, season } = await getContext();

  if (!season) {
    return (
      <div className="card">
        <div className="empty">
          <h3>No season yet</h3>
          <p>This team needs a season before files can be organized.</p>
        </div>
      </div>
    );
  }

  const [documents, targets] = await Promise.all([
    listDocuments(season.id, organization.id),
    documentTargets(season.id, organization.id),
  ]);

  return (
    <FilesClient
      documents={documents}
      summary={documentSummary(documents)}
      targets={targets}
      seasonName={season.name}
      canWrite={canWrite(profile)}
      isAdmin={profile?.role === "owner" || profile?.role === "admin"}
    />
  );
}
