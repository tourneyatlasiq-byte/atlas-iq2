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
    </>
  );
}
