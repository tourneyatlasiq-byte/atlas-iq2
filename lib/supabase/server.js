import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Request header the database reads (auth_request_org_pin) to pin a request to one organization. */
export const ORG_PIN_HEADER = "x-season-tempo-org";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function build(headers) {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      ...(headers ? { global: { headers } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot set cookies. The middleware refreshes
            // the session on every request, so this is safe to ignore.
          }
        },
      },
    }
  );
}

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Reads the session from cookies, which is also what makes any route calling
 * this dynamic. Every query runs under the caller's RLS context — we never
 * use a service-role key, so the database is the security boundary.
 *
 * Sends no organization pin. Until each caller moves to createPinnedClient()
 * (Phase 3C), the database treats an absent pin as "use the caller's active
 * organization" (the temporary 3B compatibility).
 */
export function createClient() {
  return build(null);
}

/**
 * The same client, pinned to one organization.
 *
 * Every request it sends carries x-season-tempo-org, and the database answers
 * only if that organization is the caller's active membership. A wrong or
 * stale pin returns nothing and writes nothing (it fails closed).
 *
 * The organization id must come from a membership the caller was just proven
 * to hold (see lib/auth/active-membership.js), never from user input.
 */
export function createPinnedClient(organizationId) {
  if (typeof organizationId !== "string" || !UUID.test(organizationId)) {
    throw new Error("createPinnedClient needs a valid organization id.");
  }
  return build({ [ORG_PIN_HEADER]: organizationId.toLowerCase() });
}
