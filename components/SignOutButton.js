/**
 * Sign out, for anywhere the desktop sidebar's footer isn't shown (2026-11).
 *
 * A plain form POST to the existing /logout route — the same request the
 * desktop sidebar makes. No authentication logic lives here: /logout signs
 * the session out with Supabase and answers with a 303 to /login. A form,
 * not a script, so it works even if the page around it has failed to load.
 *
 * `next` (optional) is where to return after signing back in. /logout
 * validates it; it is only ever a same-site path.
 */
export function SignOutButton({ className = "", children = "Sign out", icon = null, next = null }) {
  return (
    <form action="/logout" method="post" className="signout-form">
      {next && <input type="hidden" name="next" value={next} />}
      <button type="submit" className={className}>
        {icon}
        {children}
      </button>
    </form>
  );
}
