import { updateSession } from "./lib/supabase/middleware";

export async function middleware(request) {
  return await updateSession(request);
}

export const config = {
  /**
   * Everything except Next internals and static assets.
   *
   * The asset exclusions matter: the previous build matched /icon.svg and
   * served the login page in its place. Any new static file type added to
   * the app needs to be listed here.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
  ],
};
