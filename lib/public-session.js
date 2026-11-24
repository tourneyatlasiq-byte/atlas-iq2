import { cookies } from "next/headers";

/**
 * Display-only hint for public pages that must stay synchronous (the legal pages):
 * is a Supabase session cookie present? The middleware refreshes or clears the session on every
 * request, so a cookie that survives to the page is a live sign-in. This never grants access to
 * anything; it only chooses between "Sign in" and "Open Season Tempo" in the shared header.
 * Outside a request (tests) cookies() throws and the answer is false.
 */
export function hasSessionCookie() {
  try {
    return cookies().getAll().some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name) && Boolean(c.value));
  } catch {
    return false;
  }
}
