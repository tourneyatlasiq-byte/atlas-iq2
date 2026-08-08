"use client";

import { useState, useTransition } from "react";
import { acceptInvitation } from "../lib/actions/invite";

/** Accepting an invitation. The server decides the organization and the role. */
export function AcceptInvite({ inviteId }) {
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <p className="welcome-sub">
        Accepting adds you to the team that invited you. Your role is set by whoever sent the
        invitation.
      </p>

      <button
        className="btn btn-primary btn-block"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptInvitation(inviteId);
            if (result && !result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Joining…" : "Accept invitation"}
      </button>

      <p className="field-note welcome-foot">
        Signed in with a different email? Sign out and sign back in with the address the
        invitation was sent to.
      </p>
    </>
  );
}
