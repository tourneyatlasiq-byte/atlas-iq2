import { redirect } from "next/navigation";
import { getContext } from "../../../lib/context";
import { LogoLockup } from "../../../components/SeasonTempoLogo";
import { AcceptInvite } from "../../../components/AcceptInvite";

export const dynamic = "force-dynamic";

export const metadata = { title: "Join a team on Season Tempo" };

/**
 * Invitation acceptance, outside the app shell — the visitor has no
 * organization yet, so there is nothing to put in the sidebar.
 *
 * getContext() redirects to /login when there is no session, so arriving here
 * signed out sends them to sign in first. They must use the invited address;
 * accept_invite() matches on the invitation AND the signed-in email.
 */
export default async function InvitePage({ params }) {
  const { id } = await params;
  const { organization } = await getContext();

  // Already in an organization — an invitation cannot move them.
  if (organization) redirect("/dashboard");

  return (
    <div className="welcome-wrap">
      <div className="welcome-box">
        <div className="welcome-brand">
          <LogoLockup size={44} tone="navy" />
        </div>
        <h1 className="welcome-title">You've been invited</h1>
        <p className="welcome-lead">Join your team on Season Tempo.</p>

        <div className="card">
          <AcceptInvite inviteId={id} />
        </div>
      </div>
    </div>
  );
}
