import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "../../lib/context";
import { createClient } from "../../lib/supabase/server";
import { currentSeasonLabel, seasonOptions } from "../../lib/onboarding";
import { LogoLockup } from "../../components/SeasonTempoLogo";
import { WelcomeForm } from "../../components/WelcomeForm";
import { AccountFooter } from "../../components/AccountFooter";

export const dynamic = "force-dynamic";

export const metadata = { title: "Welcome to Season Tempo" };

const ROLE_LABELS = { coach: "Coach", manager: "Manager", parent: "Parent" };

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * First-run setup, deliberately outside the (app) route group.
 *
 * The application shell assumes an organization exists — sidebar, context
 * chips, season-scoped queries. A user who has none cannot be shown that
 * shell, so this page stands on its own.
 *
 * Invitations come first (2026-11). Someone invited to a team who signed in
 * without the invitation link — another device, or from the homepage — used
 * to see only "set up your team", and creating one would have locked them out
 * of the team that invited them. Their pending invitations are now listed
 * above setup, from my_pending_invitations() (auth_01), which only returns
 * invitations addressed to the signed-in email.
 *
 * getContext() redirects to /login when there is no session, so this is
 * reachable only by an authenticated user.
 */
export default async function WelcomePage() {
  const { user, organization } = await getContext();

  // Already set up. Nothing here applies.
  if (organization) redirect("/dashboard");

  const supabase = createClient();
  const { data: invitations, error } = await supabase.rpc("my_pending_invitations");
  // Fails open to the ordinary setup page: a lookup error must never block
  // someone from starting, it only hides the invitation shortcut.
  if (error) console.error("my_pending_invitations failed:", error.code);
  const pending = invitations ?? [];

  return (
    <div className="welcome-wrap">
      <div className="welcome-box">
        <div className="welcome-brand">
          <LogoLockup size={44} tone="navy" />
        </div>

        <h1 className="welcome-title">Welcome to Season Tempo</h1>

        {pending.length > 0 && (
          <>
            <p className="welcome-lead">
              {pending.length === 1
                ? "You've been invited to join a team."
                : "You've been invited to join these teams."}
            </p>
            <div className="card invite-card">
              <ul className="invite-list">
                {pending.map((inv) => (
                  <li key={inv.invite_id}>
                    <span className="invite-list-text">
                      <strong>{inv.team_name ?? inv.organization_name}</strong>
                      <span className="field-note">
                        {inv.organization_name} · {ROLE_LABELS[inv.role] ?? inv.role}
                        {inv.inviter_first_name ? ` · from ${inv.inviter_first_name}` : ""}
                        {inv.expires_at ? ` · expires ${fmtDate(inv.expires_at)}` : ""}
                      </span>
                    </span>
                    <Link href={`/invite/${inv.invite_id}`} className="btn btn-primary">
                      View invitation
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <h2 className="welcome-or">Or set up your own team</h2>
            <p className="welcome-value">
              Only do this if you're starting a new team. To join the team that invited you, use the
              invitation above.
            </p>
          </>
        )}

        {pending.length === 0 && (
          <>
            <p className="welcome-lead">Set up your team and start running your season.</p>
            <p className="welcome-value">
              Run your team, tournaments, money, and season in one place.
            </p>
          </>
        )}

        <div className="card">
          <p className="welcome-sub">This only takes a couple of minutes.</p>
          <WelcomeForm defaultSeason={currentSeasonLabel()} seasonOptions={seasonOptions()} />
        </div>

        <AccountFooter email={user.email} />
      </div>
    </div>
  );
}
