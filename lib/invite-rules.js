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

/**
 * What the owner is told when an invitation email didn't go out (Phase 2B).
 * The invitation itself always still exists and its link always still works.
 */
export function deliveryFailureText(code) {
  if (code === "provider_rejected" || code === "invalid_recipient") {
    return "The email couldn't be sent to that address. Check it for typos, or copy the link and send it yourself.";
  }
  return "The email couldn't be sent right now. Try again, or copy the link and send it yourself.";
}

/** Messages from invite_send_begin() that are written to be shown as-is. */
export const SEND_REFUSALS = [
  "That invitation could not be found.",
  "That invitation has already been accepted.",
  "That invitation was withdrawn.",
  "This invitation was shared by link, so it can't be emailed. To email it, revoke it and send a new invitation.",
  "That invitation is already being sent.",
  "That invitation was emailed a few minutes ago. You can send it again 10 minutes after the last email.",
  "That invitation has been emailed 5 times today. Copy the link instead, or try again tomorrow.",
  "Your organization has reached today's limit for invitation emails. Copy the link instead, or try again tomorrow.",
  "Invitation emails are paused for today. Copy the link instead, or try again tomorrow.",
];

/**
 * Stale-page guard for invitation actions (Phase 2D, 2026-11).
 *
 * Every invitation form carries the account and organization the page was
 * drawn for. If the browser has since signed in as someone else, the page
 * still shows the old organization; the server compares and refuses before
 * doing anything. This is extra protection and a clearer message — the
 * database's own organization rules still decide what any account can change.
 *
 * The invitation-specific precursor to Phase 4's broader multi-org /
 * multi-tab protection, not a replacement for it.
 */
export const RENDERED_ACCOUNT_FIELD = "rendered_account";
export const RENDERED_ORG_FIELD = "rendered_org";

export const STALE_CONTEXT_MESSAGE =
  "You're now signed in as a different account. Reload this page before making changes.";

/** True only when the form was drawn for exactly this account and organization. */
export function renderedContextMatches(formData, { accountId, organizationId }) {
  const account = formData?.get?.(RENDERED_ACCOUNT_FIELD);
  const org = formData?.get?.(RENDERED_ORG_FIELD);
  return Boolean(account && org && accountId && organizationId && account === accountId && org === organizationId);
}

/** Adds the rendered context to a FormData built in the browser. */
export function withRenderedContext(fd, accountId, organizationId) {
  fd.set(RENDERED_ACCOUNT_FIELD, accountId ?? "");
  fd.set(RENDERED_ORG_FIELD, organizationId ?? "");
  return fd;
}

/** Truthful words when an action changed nothing. */
export const NO_CHANGE = {
  withdrawn: "That invitation has already been withdrawn.",
  accepted: "That invitation has already been accepted.",
  elsewhere: "That invitation isn't in your current organization. Reload this page.",
};
