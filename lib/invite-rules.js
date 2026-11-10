/**
 * Invitation rules shared by Settings (client) and the invite actions (server).
 *
 * The database default for a new invitation is 14 days (adm_02). Renewing an
 * expired invitation gives it the same 14 days again, counted from now, and
 * keeps the same link.
 */
export const INVITE_TTL_DAYS = 14;

/** True when an unaccepted invitation is past its expiry. */
export function isInviteExpired(invite, now = new Date()) {
  if (!invite || invite.accepted_at) return false;
  if (!invite.expires_at) return false;
  return new Date(invite.expires_at).getTime() < now.getTime();
}

/** The expiry for an invitation created or renewed at `now`, as ISO text. */
export function inviteExpiryFrom(now = new Date()) {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** The link a person opens to accept. Same-origin, id only. */
export function inviteLink(origin, inviteId) {
  return `${origin}/invite/${inviteId}`;
}

/**
 * What a pending invitation row in Settings says about itself (Phase 2A).
 *
 *   expired  past its expiry date (any delivery state)
 *   manual   link shared by hand; never emailed, and never will be (inv_01)
 *   sending  an email attempt is in progress (or was just queued)
 *   sent     handed to the email provider. NOT confirmed inbox delivery.
 *   failed   the last email attempt did not reach the provider
 *
 * Unknown or missing values are treated as 'manual', the conservative reading:
 * nothing claims an email was sent unless the database says so.
 */
export function inviteRowStatus(invite, now = new Date()) {
  if (isInviteExpired(invite, now)) return "expired";
  switch (invite?.delivery_status) {
    case "sent":
      return "sent";
    case "failed":
      return "failed";
    case "queued":
    case "sending":
      return "sending";
    default:
      return "manual";
  }
}

/** Words for each status. Dates are filled in by the caller. */
export const INVITE_STATUS_TEXT = {
  manual: "Link shared manually",
  sending: "Sending…",
  sent: "Sent",
  failed: "Couldn't send",
  expired: "Expired",
};

/** Explains "Sent" honestly wherever it is shown (title text / help). */
export const SENT_MEANS =
  "Handed to our email provider. That doesn't confirm it reached their inbox.";
