import { redirect } from "next/navigation";
import { getContext } from "../../lib/context";
import { NavSidebar } from "../../components/NavSidebar";
import { HelpMenu } from "../../components/HelpMenu";

// Reads cookies, so this subtree is dynamic. Nothing here is ever prerendered.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }) {
  const { user, organization, team, season } = await getContext();

  // No organization yet means a brand-new signup, not a misconfigured account.
  // Setup lives outside this shell, which assumes an organization exists.
  if (!organization) redirect("/welcome");

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

          <HelpMenu />
        </header>

        <main className="content">
          {children}

        </main>
      </div>
    </div>
  );
}
