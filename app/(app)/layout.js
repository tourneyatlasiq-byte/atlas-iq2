import { redirect } from "next/navigation";
import { getContext } from "../../lib/context";
import { NavSidebar } from "../../components/NavSidebar";
import { HelpMenu } from "../../components/HelpMenu";
import { AppFooter } from "../../components/AppFooter";
import { SeasonBanner } from "../../components/SeasonBanner";

// Reads cookies, so this subtree is dynamic. Nothing here is ever prerendered.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }) {
  const { user, organization, team, season, seasons, seasonPhase, currentSeason } = await getContext();

  // No organization yet means a brand-new signup, not a misconfigured account.
  // Setup lives outside this shell, which assumes an organization exists.
  if (!organization) redirect("/welcome");

  return (
    <div className="shell">
      <NavSidebar
        email={user.email}
        organization={organization}
        team={team}
        season={season}
        seasons={seasons}
        seasonPhase={seasonPhase}
      />

      <div className="main">
        {/* Season moved into the sidebar identity block, so this bar now holds
            only Help and is sized accordingly. */}
        <header className="topbar topbar-slim">
          <HelpMenu />
        </header>

        <main className="content">
          <SeasonBanner
            phase={seasonPhase}
            seasonName={season?.name}
            currentSeasonName={currentSeason?.name}
          />
          {children}

          <AppFooter />
        </main>
      </div>
    </div>
  );
}
