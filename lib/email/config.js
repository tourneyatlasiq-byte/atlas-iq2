/**
 * Whether Season Tempo may send invitation email (Phase 2B).
 *
 * ALL THREE must hold, or nothing is sent:
 *   1. VERCEL_ENV is exactly "production". Preview and local builds can never
 *      send, even if someone copies the key and the switch into them. Vercel
 *      sets this variable itself; it is not something we configure.
 *   2. INVITE_EMAILS_ENABLED is exactly "true" (not "TRUE", "1" or "yes").
 *   3. RESEND_API_KEY is present.
 *
 * Off by default: with nothing configured, invitations behave exactly as in
 * 2A — created, then shared by Copy link.
 *
 * Takes the environment as a parameter so tests can prove every combination.
 */
export function inviteEmailsEnabled(env = process.env) {
  return (
    env.VERCEL_ENV === "production" &&
    env.INVITE_EMAILS_ENABLED === "true" &&
    typeof env.RESEND_API_KEY === "string" &&
    env.RESEND_API_KEY.trim().length > 0
  );
}

/** Fixed sender and reply address (approved 2026-11). */
export const INVITE_FROM = "Season Tempo <invitations@auth.seasontempo.com>";
export const INVITE_REPLY_TO = "support@seasontempo.com";

/** The canonical site; invitation links always point at production. */
export const SITE_URL = "https://www.seasontempo.com";
