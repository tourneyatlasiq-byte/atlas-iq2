import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { safeNext, signInErrorReason } from "../../../lib/auth-redirect";

export const dynamic = "force-dynamic";

/**
 * Exchanges the magic-link code for a session cookie, then redirects inward.
 *
 * `next` is validated to a same-site path before it is used anywhere. On any
 * failure the person is sent back to /login with a short reason key (never raw
 * provider text) and with their `next` preserved, so an invited person who
 * has to request a new link still lands on their invitation afterwards.
 */
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  function fail(reason) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", reason);
    if (next !== "/dashboard") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  // Supabase reports link problems (for example an expired link) as query
  // parameters on the redirect, with no code.
  const providerError = searchParams.get("error_code") || searchParams.get("error");
  if (providerError) {
    return fail(
      signInErrorReason({
        errorCode: searchParams.get("error_code"),
        error: searchParams.get("error"),
        description: searchParams.get("error_description"),
      })
    );
  }

  if (!code) return fail("missing");

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const reason = signInErrorReason({ message: error.message });
    console.error("auth callback failed:", reason);
    return fail(reason);
  }

  return NextResponse.redirect(new URL(next, origin));
}
