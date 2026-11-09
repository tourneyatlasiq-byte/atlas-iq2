import { SignOutButton } from "./SignOutButton";

/**
 * "Signed in as … · Sign out" for the pages that live outside the app shell
 * (/welcome, /invite), which have no sidebar and therefore no other way to end
 * the session (2026-11). `next` returns the person to this page after they
 * sign back in, e.g. as the account an invitation was sent to.
 */
export function AccountFooter({ email, next = null, label = "Sign out" }) {
  return (
    <div className="welcome-account">
      {email && (
        <span>
          Signed in as <strong>{email}</strong>
        </span>
      )}
      <SignOutButton className="btn btn-ghost" next={next}>
        {label}
      </SignOutButton>
    </div>
  );
}
