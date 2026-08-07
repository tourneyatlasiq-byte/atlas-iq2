import { getContext } from "../../lib/context";
import { NavSidebar } from "../../components/NavSidebar";

// Reads cookies, so this subtree is dynamic. Nothing here is ever prerendered.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }) {
  const { user, organization, team, season } = await getContext();

  return (
    <div className="shell">
      <NavSidebar email={user.email} />

      <div className="main">
        <header className="topbar">
          <div className="context-chips">
            <span className="chip">
              Organization <strong>{organization?.name ?? "Not linked"}</strong>
            </span>
            <span className="chip">
              Team <strong>{team?.name ?? "None"}</strong>
            </span>
            <span className="chip chip-season">
              Season <strong>{season?.name ?? "None"}</strong>
            </span>
          </div>
        </header>

        <main className="content">
          {!organization ? (
            <div className="card">
              <div className="empty">
                <h3>This account isn't linked to an organization</h3>
                <p>
                  Your sign-in worked, but there's no organization attached to it yet, so there's
                  nothing to show. An administrator needs to add you to one.
                </p>
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
