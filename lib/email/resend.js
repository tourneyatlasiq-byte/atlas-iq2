/**
 * The Resend integration boundary (Phase 2B).
 *
 * THE ONLY FILE that reads RESEND_API_KEY or talks to api.resend.com.
 * SERVER ONLY: imported by a server action, never by a client component, so
 * the key cannot reach the browser bundle. scripts/check-invite-email.js
 * asserts both rules.
 *
 * Returns { ok: true, id } or { ok: false, code } where code is one of the
 * short values inv_01 accepts. Resend's own message text is never returned,
 * logged or stored: it can echo addresses and is not written for coaches.
 *
 * No tracking: open and click tracking are off for the sending domain, and
 * nothing here adds tracking parameters, pixels or tags.
 */
import { inviteEmailsEnabled, INVITE_FROM, INVITE_REPLY_TO } from "./config";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

/** Maps an HTTP status from Resend to one of our short error codes. */
export function resendErrorCode(status) {
  if (status === 401 || status === 403) return "not_configured";
  if (status === 422 || status === 400) return "provider_rejected";
  if (status === 429 || status >= 500) return "provider_unavailable";
  return "unknown";
}

/**
 * Sends one email. `idempotencyKey` makes a retried request for the same
 * attempt a no-op at Resend, so a network retry can't send twice.
 */
export async function sendEmail(
  { to, subject, html, text, idempotencyKey },
  { env = process.env, fetchImpl = fetch } = {}
) {
  // Re-checked here as well as by the caller: this boundary refuses to send
  // outside production with the switch on, whatever calls it.
  if (!inviteEmailsEnabled(env)) return { ok: false, code: "not_configured" };

  let res;
  try {
    res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: INVITE_FROM,
        to: [to],
        reply_to: INVITE_REPLY_TO,
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    return { ok: false, code: timedOut ? "timeout" : "provider_unavailable" };
  }

  if (!res.ok) return { ok: false, code: resendErrorCode(res.status) };

  try {
    const body = await res.json();
    const id = typeof body?.id === "string" ? body.id.slice(0, 200) : null;
    return { ok: true, id };
  } catch {
    // Accepted (2xx) but the body was unreadable: it was still handed over.
    return { ok: true, id: null };
  }
}
