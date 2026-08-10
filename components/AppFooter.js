import Link from "next/link";
import { SUPPORT_EMAIL } from "../lib/legal";

/**
 * The footer inside the application.
 *
 * Rendered once in app/(app)/layout.js, so it appears on Home, Tournaments,
 * Team, Facilities, Finance, Files and Settings without any page adding it.
 *
 * Deliberately not the marketing footer: this is software, and a Product /
 * Company column grid under a roster table would read as a landing page. One
 * quiet line, inside the content column so it aligns with the page rather than
 * running under the sidebar.
 */
export function AppFooter() {
  return (
    <footer className="app-footer">
      <span className="app-footer-copy">© {new Date().getFullYear()} Season Tempo</span>
      <nav className="app-footer-links" aria-label="Legal and support">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
      </nav>
    </footer>
  );
}
