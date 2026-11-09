import { NextResponse } from "next/server";
import { createClient } from "../../lib/supabase/server";
import { safeNext } from "../../lib/auth-redirect";

export const dynamic = "force-dynamic";

/**
 * Signs out and returns to /login.
 *
 * An optional form field `next` (validated to a same-site path) is carried to
 * the login page, so "Sign out and continue" on an invitation brings the
 * person straight back to that invitation once they sign in as the right
 * account.
 */
export async function POST(request) {
  let next = null;
  try {
    const form = await request.formData();
    next = safeNext(form.get("next"), null);
  } catch {
    // No body (the ordinary Sign out button): nothing to carry over.
  }

  const supabase = createClient();
  await supabase.auth.signOut();

  const url = new URL("/login", request.url);
  if (next) url.searchParams.set("next", next);
  return NextResponse.redirect(url, { status: 303 });
}
