import { redirect } from "next/navigation";
import { getContext } from "../../lib/context";
import { currentSeasonLabel, seasonOptions } from "../../lib/onboarding";
import { LogoLockup } from "../../components/SeasonTempoLogo";
import { WelcomeForm } from "../../components/WelcomeForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Welcome to Season Tempo" };

/**
 * First-run setup, deliberately outside the (app) route group.
 *
 * The application shell assumes an organization exists — sidebar, context
 * chips, season-scoped queries. A user who has none cannot be shown that
 * shell, so this page stands on its own.
 *
 * getContext() redirects to /login when there is no session, so this is
 * reachable only by an authenticated user.
 */
export default async function WelcomePage() {
  const { organization } = await getContext();

  // Already set up. Nothing here applies.
  if (organization) redirect("/dashboard");

  return (
    <div className="welcome-wrap">
      <div className="welcome-box">
        <div className="welcome-brand">
          <LogoLockup size={44} tone="navy" />
        </div>

        <h1 className="welcome-title">Welcome to Season Tempo</h1>
        <p className="welcome-lead">Set up your team and start running your season.</p>
        <p className="welcome-value">
          Run your team, tournaments, money, and season in one place.
        </p>

        <div className="card">
          <p className="welcome-sub">This only takes a couple of minutes.</p>
          <WelcomeForm defaultSeason={currentSeasonLabel()} seasonOptions={seasonOptions()} />
        </div>
      </div>
    </div>
  );
}
