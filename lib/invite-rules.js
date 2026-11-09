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
