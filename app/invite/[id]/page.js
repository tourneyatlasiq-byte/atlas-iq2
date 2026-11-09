import Link from "next/link";
import { getContext } from "../../../lib/context";
import { createClient } from "../../../lib/supabase/server";
import { LogoLockup } from "../../../components/SeasonTempoLogo";
import { AcceptInvite } from "../../../components/AcceptInvite";
import { AccountFooter } from "../../../components/AccountFooter";

export const dynamic = "force-dynamic";

export const metadata = { title: "Join a team on Season Tempo" };

const ROLE_LABELS = { coach: "Coach", manager: "Manager", parent: "Parent" };

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Invitation landing, outside the app shell.
 *
 * Every state is explained on the page — this used to redirect an account
 * that already had an organization to its own dashboard without a word.
 * What the viewer is shown comes from invitation_for_viewer() (auth_01), which
 * reveals only what the holder of this link should see. Acceptance itself is
 * unchanged: accept_invite() re-checks the email, expiry and use.
 *
 * Signed-out visitors never reach here: middleware sends them to
 * /login?next=/invite/<id> first.
 */
export default async function InvitePage({ params }) {
  const { id } = await params;
  const { user, organization } = await getContext();
  const here = `/invite/${id}`;

  const supabase = createClient();
  const { data, error } = await supabase.rpc("invitation_for_viewer", { p_invite_id: id });
  // A malformed id is an invalid uuid to Postgres; to the visitor it is
  // simply a link we don't recognise.
  if (error && error.code !== "22P02") console.error("invitation_for_viewer failed:", error.code);
  const view = error || !data ? { status: "not_found" } : data;

  const org = view.organization_name;
  const team = view.team_name;
  const role = ROLE_LABELS[view.role] ?? view.role;
  const inviter = view.inviter_first_name;
  const dashboard = organization ? (
    <Link href="/dashboard" className="btn btn-secondary btn-block">
      Go to {organization.name}
    </Link>
  ) : null;

  let title = "You've been invited";
  let body = null;

  switch (view.status) {
    case "ready":
      title = "You've been invited";
      body = (
        <>
          <p className="invite-summary">
            {inviter ? `${inviter} invited you` : "You've been invited"} to join{" "}
            <strong>{team ?? org}</strong>
            {team && org && team !== org ? <> ({org})</> : null} as a <strong>{role}</strong>.
          </p>
          {view.expires_at && (
            <p className="field-note invite-expiry">This invitation expires {fmtDate(view.expires_at)}.</p>
          )}
          <AcceptInvite inviteId={id} />
        </>
      );
      break;

    case "wrong_account":
      title = "This invitation is for a different email";
      body = (
        <>
          <p className="invite-summary">
            This invitation to join <strong>{team ?? org}</strong> was sent to{" "}
            <strong>{view.invited_email_masked}</strong>. You're signed in as{" "}
            <strong>{user.email}</strong>.
          </p>
          <p className="field-note">
            Sign out, then sign in with the address the invitation was sent to. You'll come
            straight back here.
          </p>
          <AccountFooter next={here} label="Sign out and continue" />
        </>
      );
      break;

    case "expired":
      title = "This invitation has expired";
      body = (
        <>
          <p className="invite-summary">
            Your invitation to join <strong>{team ?? org}</strong> as a {role} is no longer valid.
          </p>
          <p className="field-note">
            Ask {inviter ?? "the person who invited you"} at {org} to renew it. The same link will
            work again once they do.
          </p>
          {dashboard}
        </>
      );
      break;

    case "accepted_by_you":
    case "already_member":
      title = "You're already on this team";
      body = (
        <>
          <p className="invite-summary">
            Your account is already a member of <strong>{org}</strong>.
          </p>
          <Link href="/dashboard" className="btn btn-primary btn-block">
            Open Season Tempo
          </Link>
        </>
      );
      break;

    case "other_org":
      title = "You're invited to another organization";
      body = (
        <>
          <p className="invite-summary">
            You've been invited to join <strong>{team ?? org}</strong> as a <strong>{role}</strong>,
            but this account already belongs to <strong>{view.viewer_organization_name}</strong>.
          </p>
          <p className="field-note">
            Season Tempo can't yet put one account in two organizations. We're adding that now, so
            please don't create a second account — keep this invitation. If it expires before then,{" "}
            {org} can renew it and the same link will work.
          </p>
          {dashboard}
        </>
      );
      break;

    case "used":
      title = "This invitation has already been used";
      body = (
        <>
          <p className="invite-summary">
            If you think that's a mistake, ask the person who invited you to send a new invitation.
          </p>
          {dashboard}
        </>
      );
      break;

    default:
      title = "We couldn't find that invitation";
      body = (
        <>
          <p className="invite-summary">
            Check that you opened the whole link from your invitation, or ask the person who invited
            you to send it again.
          </p>
          {dashboard}
        </>
      );
  }

  return (
    <div className="welcome-wrap">
      <div className="welcome-box">
        <div className="welcome-brand">
          <LogoLockup size={44} tone="navy" />
        </div>
        <h1 className="welcome-title">{title}</h1>

        <div className="card invite-card">{body}</div>

        {view.status !== "wrong_account" && <AccountFooter email={user.email} next={here} />}
      </div>
    </div>
  );
}
