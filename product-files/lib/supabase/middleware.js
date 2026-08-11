import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Prefix matches. "/" is deliberately NOT in this list — startsWith("/")
// would match every route and make the whole application public.
const PUBLIC_PREFIXES = ["/login", "/auth/callback"];

// Exact matches only. Exact rather than prefix so a future /privacy-settings
// or /terms-admin route is not made public by accident.
const PUBLIC_EXACT = ["/", "/product", "/privacy", "/terms"];

/**
 * Refreshes the Supabase session on every request and gates private routes.
 *
 * Cookies must be written to the same response object that is returned,
 * otherwise a refreshed token is silently dropped and the user gets logged
 * out at random.
 */
export async function updateSession(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
