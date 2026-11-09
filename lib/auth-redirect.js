/**
 * Sign-in redirects and sign-in errors, in one place (2026-11).
 *
 * `next` travels through the sign-in link, the callback and sign-out, so all
 * three must agree on what a safe destination is. Only a same-site path is
 * allowed: it must start with a single "/", and nothing that a browser could
 * read as another host ("//evil.com", "/\evil.com", "@evil.com") gets through.
 *
 * Sign-in errors are reduced to a short reason key before they reach the URL,
 * so the login page shows our own words, never raw provider text.
 */

const DEFAULT_NEXT = "/dashboard";

/** A same-site path, or `fallback` when the value is missing or unsafe. */
export function safeNext(value, fallback = DEFAULT_NEXT) {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (v.length === 0 || v.length > 512) return fallback;
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//")) return fallback;
  if (v.includes("\\")) return fallback;
  // Control characters and whitespace have no place in an internal path and
  // are how several browser parsing tricks start.
  if (/[\u0000-\u001f\u007f\s]/.test(v)) return fallback;
  return v;
}

/** True when `next` points at an invitation, which changes the login framing. */
export function isInvitePath(next) {
  return typeof next === "string" && /^\/invite\/[^/?#]+/.test(next);
}

/**
 * Turns whatever went wrong in the sign-in callback into one of a few reasons.
 *
 *   expired        the link timed out
 *   other_browser  opened somewhere other than where it was requested (PKCE)
 *   used           already used, or otherwise no longer valid
 *   missing        the callback arrived without a code
 *   failed         anything else
 */
export function signInErrorReason({ errorCode, error, description, message } = {}) {
  const text = [errorCode, error, description, message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!text) return "failed";
  if (text.includes("otp_expired") || text.includes("expired")) return "expired";
  if (text.includes("code verifier") || text.includes("code_verifier")) return "other_browser";
  if (text.includes("flow state") || text.includes("already been used") || text.includes("invalid"))
    return "used";
  if (text.includes("missing")) return "missing";
  return "failed";
}

/** What the login page says for each reason. Unknown keys get the generic one. */
export const SIGN_IN_ERRORS = {
  expired: "That sign-in link has expired. Enter your email below and we'll send you a new one.",
  other_browser:
    "Sign-in links only work in the browser where you asked for them. Send a new one from here, then open the link on this device or type the sign-in code from the email.",
  used: "That sign-in link has already been used or is no longer valid. Send yourself a new one below.",
  missing: "We couldn't sign you in with that link. Send yourself a new one below.",
  failed: "We couldn't sign you in with that link. Send yourself a new one below.",
};

export function signInErrorMessage(reason) {
  if (!reason) return null;
  return SIGN_IN_ERRORS[reason] ?? SIGN_IN_ERRORS.failed;
}

/**
 * The sign-in code (2026-11), as typed: spaces and dashes are allowed and
 * ignored. The length is a Supabase setting (production sends 8 digits;
 * Supabase allows 6 to 10), so nothing here assumes a particular length:
 * any 6 to 10 digits pass, and Supabase decides whether the code is right.
 * Returns null when the input can't be a code at all.
 */
export function normalizeOtp(value) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{6,10}$/.test(digits) ? digits : null;
}

/** One message for a code that didn't work, whatever the provider's reason. */
export const OTP_ERROR =
  "That code didn't work. Codes can only be used once and expire after a while. Check you used the most recent email, or send a new one.";
