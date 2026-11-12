import { redirect } from "next/navigation";
import { getContext, isOrgAdmin, canWrite } from "../../lib/context";
import { NavSidebar } from "../../components/NavSidebar";
import { HelpContextProvider } from "../../components/HelpContext";
import { AppFooter } from "../../components/AppFooter";
import { SeasonBanner } from "../../components/SeasonBanner";

// Reads cookies, so this subtree is dynamic. Nothing here is ever prerendered.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }) {
  const { user, profile, organization, team, season, seasons, seasonPhase, currentSeason, features } =
    await getContext();

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
        features={features}
      />

      <div className="main">
        <main className="content">
          <SeasonBanner
            phase={seasonPhase}
            seasonName={season?.name}
            currentSeasonName={currentSeason?.name}
          />
          {/* Lets Help (popover and contextual answers) know whether QAB is on and
              what this person may do (2026-11). Presentation only. */}
          <HelpContextProvider
            qab={features?.qab}
            isAdmin={isOrgAdmin(profile)}
            canWrite={canWrite(profile)}
            phase={seasonPhase}
          >
            {children}
          </HelpContextProvider>

          <AppFooter />
        </main>
      </div>
    </div>
  );
}
